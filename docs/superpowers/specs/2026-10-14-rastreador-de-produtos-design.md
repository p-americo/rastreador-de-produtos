# Rastreador de Produtos — Design

**Data:** 2026-10-14
**Status:** aprovado em conversa, aguardando revisão da spec escrita
**Repositório:** https://github.com/p-americo/rastreador-de-produtos

## 1. Objetivo

Monitorar anúncios de produtos usados (inicialmente **PS Vita**, **Nintendo Switch** e **Nintendo Switch Lite** na **OLX**) e enviar uma notificação no celular, em segundos, quando surgir um anúncio com preço **igual ou abaixo** do teto definido para aquele produto. Esses anúncios são vendidos muito rápido, então a latência importa mais que tudo.

O sistema deve ser **agnóstico**: adicionar novos produtos é editar um arquivo, e adicionar novas fontes (ex.: Mercado Livre) ou novos canais de notificação é criar um adaptador, sem mexer no restante.

### Critérios de sucesso

- Um anúncio novo dentro das regras gera notificação no Discord em até ~40s após aparecer na busca da OLX.
- Cada anúncio notifica **uma única vez**, salvo em caso de nova queda de preço.
- Acessórios, aparelhos com defeito, trocas e anúncios-isca são filtrados por regras configuráveis.
- Bloqueios e quebras de layout geram aviso. O rastreador nunca falha em silêncio enquanto está rodando.

### Contexto e premissas

- Uso pessoal: um único destinatário (o próprio usuário).
- Roda inicialmente no PC Windows do usuário e deve poder migrar para um servidor (Docker) sem reescrita.
- Fora de escopo nesta versão: painel web, comandos pelo Discord, filtro por IA, resumo diário, monitor externo de "vida".

## 2. Restrição técnica: Cloudflare na OLX

Investigação feita em 2026-10-14:

- Uma requisição HTTP simples (`fetch` do Node com cabeçalhos de navegador) para a busca da OLX recebe **403 da Cloudflare** ("Attention Required").
- A mesma URL num navegador real carrega normalmente. A página de busca renderiza cards `section.olx-adcard` (50 por página) com título, preço, cidade/bairro, data/hora, link (`…-<listId>`), miniatura e a marca "Impulsionado" quando aplicável.
- A página é Next.js (App Router). Não há `__NEXT_DATA__`; os dados vêm em chunks `self.__next_f.push`. A extração será feita **pelo DOM renderizado**.

**Decisão:** controlar um **navegador real (Playwright + Chromium)** com perfil persistente. O rastreador **não tenta burlar** proteções anti-bot (sem disfarce de assinatura TLS, sem resolução automática de desafios). Se surgir um desafio, ele pausa e pede ao usuário que resolva manualmente.

**Ritmo:** consultas sequenciais, uma página por vez, a cada 30s ± variação aleatória. Com 3 produtos, são cerca de 6 carregamentos por minuto.

**Risco aceito:** raspar a OLX pode contrariar os termos de uso do site. O uso é pessoal e em baixo ritmo, e o pior caso esperado é bloqueio temporário de IP.

## 3. Arquitetura

**Stack:** Node.js 24 + TypeScript (executado com `tsx`), Playwright (Chromium), SQLite embutido (`node:sqlite`), `yaml` + `zod` para config, `vitest` para testes.

### Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| `config` | Lê `watches.yaml`, valida com zod, mescla `defaults`, recarrega ao detectar mudança no arquivo | — |
| `scheduler` | Agenda o próximo ciclo de cada produto (intervalo ± variação), executa um por vez, aplica recuo e pausa por fonte | config |
| `browser` | Mantém **um** Chromium com perfil persistente em `data/browser-profile/`, uma aba por fonte; relança se cair | Playwright |
| `sources/` | Adaptadores por site. Interface `Source` (abaixo). Primeiro: `olx.ts` | browser |
| `listing` | Tipo padrão de anúncio | — |
| `matcher` | Decide se um anúncio atende às regras de um produto e explica o motivo quando não atende | listing |
| `decide` | Função pura que, a partir do resultado do filtro e do histórico, decide a ação de alerta | listing, matcher |
| `store` | Persistência em SQLite (`data/tracker.db`) | — |
| `notifiers/` | Interface `Notifier` (abaixo). Primeiro: `discord.ts` (webhook) | listing |
| `main` | Orquestra o ciclo e os comandos de CLI | todos |

### Interfaces

```ts
interface Listing {
  source: string;          // "olx"
  id: string;              // id do anúncio na fonte (ex.: listId da OLX)
  title: string;
  priceCents: number | null;
  url: string;
  image?: string;
  location?: string;       // "Americana, Jardim Boer I"
  postedAt?: string;       // texto ou ISO, como a fonte fornecer
  boosted: boolean;        // "Impulsionado"
}

interface Source {
  id: string;
  buildUrl(watch: Watch, page: number): string;   // page começa em 1
  extract(page: PlaywrightPage): Promise<Listing[]>;
  detectBlock(page: PlaywrightPage, status: number | null): Promise<"ok" | "challenge" | "blocked">;
}

interface Notifier {
  send(alerts: Alert[]): Promise<void>;   // lança erro se o envio falhar
}

type AlertKind = "new" | "price_drop" | "price_drop_again";
interface Alert { kind: AlertKind; watch: Watch; listing: Listing; previousPriceCents?: number }
```

Adicionar uma fonte = criar `sources/<nome>.ts` implementando `Source` e registrá-la. Adicionar um canal = criar `notifiers/<nome>.ts` implementando `Notifier`.

## 4. Configuração

Segredos ficam em `.env` (fora do git). Exemplo em `.env.example`:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

`watches.yaml`:

```yaml
settings:
  intervalSeconds: 30        # base entre consultas de cada produto
  jitterSeconds: 10          # variação aleatória: ciclo entre 25s e 40s
  headless: false            # janela visível no PC
  notifier: discord          # usa DISCORD_WEBHOOK_URL
  initialPages: 3            # páginas lidas na primeira consulta de um produto
  retentionDays: 30

defaults:
  # palavras ignoradas no INÍCIO do título antes de checar startsWith
  ignorePrefixes: [console, nintendo, nitendo, sony, playstation, video game,
                   videogame, vendo, vende se, novo, nova]
  # só problemas reais; acessórios NÃO entram aqui (ver seção 5)
  exclude: [defeito, defeituoso, quebrado, quebrada, nao liga, nao funciona,
            pecas, sucata, troco, so troca, somente troca, apenas troca,
            procuro, compro, aluguel, caixa vazia, so a caixa, somente a caixa]

watches:
  - id: switch-lite
    name: Nintendo Switch Lite
    source: olx
    query: switch lite
    region: brasil
    maxPrice: 900
    minPrice: 400
    startsWith: ["switch lite|swich lite|switchlite"]

  - id: switch
    name: Nintendo Switch (demais modelos)
    source: olx
    query: nintendo switch
    region: sp
    maxPrice: 1200
    minPrice: 400
    startsWith: ["switch|swich"]
    exclude: [lite]

  - id: ps-vita
    name: PS Vita
    source: olx
    query: ps vita
    region: brasil
    maxPrice: 700
    minPrice: 300
    startsWith: ["ps vita|psvita|vita"]
```

Os valores de preço acima são exemplos. O usuário define os reais. Referência de mercado coletada em 2026-10-14: Switch Lite a partir de ~R$ 850, PS Vita a partir de ~R$ 370 e Switch V1/V2 a partir de ~R$ 1.150.

**Calibragem do `minPrice`:** é um equilíbrio. Alto demais perde a oferta rara; baixo demais deixa passar um jogo ocasional. Como perder uma oferta custa mais que receber um alerta errado, o piso deve ficar **logo acima do preço dos jogos/acessórios que escapam do filtro de texto**, e não perto do preço de mercado. Nos dados reais, os jogos que escaparam custavam até R$ 289 e o console mais barato custava R$ 370; daí os pisos de exemplo de 300/400.

### Campos de um produto (`watch`)

| Campo | Obrigatório | Descrição |
|---|---|---|
| `id` | sim | Identificador único, usado no banco e na CLI |
| `name` | sim | Nome exibido na notificação |
| `source` | sim | Fonte registrada (`olx`) |
| `query` | sim\* | Texto da busca |
| `region` | não | `brasil` (padrão), sigla do estado (`sp`) ou `estado/regiao` (`sp/grande-campinas`) |
| `searchUrl` | sim\* | URL de busca pronta da fonte; substitui `query` + `region`. A ordenação por mais recentes e a paginação são aplicadas por cima |
| `maxPrice` | sim | Teto em reais (inclusivo) |
| `minPrice` | não | Piso em reais (inclusivo); corta iscas e acessórios |
| `startsWith` | sim | Formas de escrever o produto (`a\|b` = alternativas, incluindo erros de digitação comuns). O título, após remover `ignorePrefixes` do início, precisa **começar** com uma delas |
| `include` | não | Termos que **todos** devem aparecer em qualquer ponto do título; `a\|b` aceita qualquer alternativa |
| `exclude` | não | Termos que descartam o anúncio; somados a `defaults.exclude` |
| `ignorePrefixes` | não | Somados a `defaults.ignorePrefixes` |
| `enabled` | não | `false` desativa sem apagar (padrão `true`) |
| `webhookEnv` | não | Nome da variável de ambiente com outro webhook (ex.: um canal por produto) |

\* Exatamente um entre `query` e `searchUrl`.

### Modelagem dos produtos Switch

Switch Lite e os demais Switch (V1, V2, OLED, Switch 2) são **dois produtos com tetos diferentes**. O produto "demais modelos" usa `exclude: [lite]` para que um anúncio de Lite nunca seja avaliado pelo teto maior. O produto Lite exige `startsWith: switch lite`, então um "Nintendo Switch Desbloqueado + MicroSD" que apareça na busca do Lite é descartado ali e capturado pelo outro produto.

### Recarga a quente

O arquivo é observado. Se a nova versão for válida, passa a valer no próximo ciclo de cada produto. Se for inválida, a última config válida é mantida e o erro de validação é enviado ao Discord e ao log. Um produto novo (ou com `id` novo) passa pela leitura inicial de `initialPages` páginas.

## 5. Regras de filtro (`matcher`)

### Princípio

Quando um acessório ou jogo é **o item vendido**, ele aparece **antes** do console no título ("Case Nintendo switch LITE", "Capinha psvita 2000", "Jogo PS Vita…", "Controle sem fio para Nintendo Switch", "Carregador original de PS Vita"). Quando é **brinde**, aparece **depois** ("Switch Lite com caixa + película", "Nintendo Switch Lite Coral Case + Película + Carregador"). Por isso o filtro principal é **"o título começa com o produto"**, e palavras de acessório **não** entram em `exclude`. Se entrassem, descartariam consoles vendidos com capa, case ou película, que costumam ser bons negócios.

### Regras, na ordem

1. **Normalização:** título em minúsculas, sem acentos (NFD + remoção de diacríticos), qualquer caractere fora de `a-z0-9` trocado por espaço e espaços colapsados. O mesmo vale para os termos da config. Ex.: "?Nintendo Switch-Lite!" → `nintendo switch lite`.
2. **Remoção de prefixos:** enquanto o título começar com um termo de `ignorePrefixes` (como palavra/frase inteira), esse termo é removido. Ex.: `console nintendo switch oled` → `switch oled`; `playstation vita fat` → `vita fat`.
3. **startsWith:** o título resultante precisa começar com uma das alternativas, como palavra/frase inteira (`switch` casa com `switch oled`, mas não com `switchx`). Caso contrário: `reason: "startsWith"`.
4. **include:** todos os termos precisam aparecer em algum ponto do título normalizado, como palavra/frase inteira; `|` = alternativas.
5. **exclude:** se qualquer termo (`defaults.exclude` ∪ `watch.exclude`) aparecer como palavra/frase inteira, o anúncio é descartado. Ex.: `troco` descarta "Pokemon Sword e Shield - Troco", mas "Avaliamos troca" passa, porque só `so troca`/`somente troca`/`apenas troca` são excluídos.
6. **Preço:** precisa haver preço e `minPrice ≤ preço ≤ maxPrice`. Anúncio sem preço é descartado. O `minPrice` é a rede de segurança para o que escapar do texto.
7. Anúncios "Impulsionados" **não** são descartados.
8. O matcher retorna `{ ok: true }` ou `{ ok: false, reason }` (ex.: `startsWith`, `exclude:"defeito"`, `price>max`). O motivo é usado pelo comando `check`.

Só o **título** é avaliado. A descrição exigiria abrir cada anúncio, o que multiplicaria as requisições.

### Validação com dados reais (2026-10-14)

As regras 1–5 foram simuladas em ~150 títulos reais das buscas "switch lite", "nintendo switch" e "ps vita" (categoria Games, mais recentes), salvos em `tests/fixtures/titles.json`:

- **Todos os consoles foram aprovados**, inclusive "…com Case e Capas", "…Case + Película + Carregador", "/ capinha Acrílico", "Avaliamos Troca", "Nitendo swich lite" e "Psvita" (R$ 370).
- **Acessórios e jogos com o item no início foram descartados:** "Case Nintendo switch LITE", "Capinha psvita 2000", "Kit PS Vita…", "Controle Sem Fio… Switch Lite", "Memory Card PSVita", "Carregador Original de PS Vita", "Jogo… PS Vita", "Yu-Gi-Oh! Rush Duel - Nintendo Switch", "Animal Crossing… - Nintendo Switch".
- **Lites foram descartados no produto "demais modelos"**, e o "Nintendo Switch Desbloqueado + MicroSD…" foi descartado no produto Lite.
- **Escaparam do filtro de texto 4 jogos**, todos no formato "<produto> - <nome do jogo>": "Psvita - Caligula…" (R$ 189), "Psvita - MotoGP 13…" (R$ 259), "Psvita - Stranger of Sword City…" (R$ 289) e "Nintendo Switch 2 - EA FC 26" (R$ 200). Os pisos de exemplo (300/400) eliminam todos.

Avaliado e rejeitado: excluir a palavra `jogo` (singular). Ela removeria um desses jogos, mas também descartaria anúncios como "PS Vita com jogo".

## 6. Fluxo de dados

### Ciclo de um produto

1. O `scheduler` escolhe o próximo produto cujo horário venceu e cuja fonte não está pausada.
2. O adaptador monta a URL (ordenação por mais recentes) e a aba da fonte navega até ela.
3. `detectBlock` classifica a página: `ok`, `challenge` ou `blocked` (seção 7).
4. `extract` transforma os cards em `Listing[]`.
5. Para cada anúncio: `matcher` → leitura do histórico → `decide` → ação.
6. Os alertas do ciclo são enviados juntos ao notifier. Em caso de sucesso, o banco é atualizado com o preço notificado.
7. O próximo ciclo do produto é agendado para `intervalSeconds ± jitterSeconds`.

Na **primeira consulta** de um produto (sem registros no banco), são lidas `initialPages` páginas, e os anúncios que passam no filtro são **notificados** (escolha do usuário). Nas consultas seguintes, só a página 1.

### Decisão de alerta (`decide`)

Chave do histórico: `(source, listing_id, watch_id)`.

| Histórico | Filtro | Condição | Ação |
|---|---|---|---|
| inexistente | passa | — | alerta `new` |
| inexistente | não passa | — | registra em silêncio |
| existe, nunca notificado | passa | — | alerta `price_drop` (com preço anterior) |
| existe, notificado | passa | preço < preço notificado | alerta `price_drop_again` (com preço notificado) |
| existe, notificado | passa | preço ≥ preço notificado | nada |
| existe | não passa | — | só atualiza `last_seen` / `last_price` |

Consequência intencional: aumentar `maxPrice` (ou relaxar regras) faz anúncios já vistos que passam a atender gerarem `price_drop` na próxima consulta. Nesse caso o rótulo "preço baixou" não é literal. A mensagem mostra "agora dentro do limite" quando o preço atual não for menor que o anterior.

### Banco (`data/tracker.db`)

Tabela `listings`:

| Coluna | Tipo |
|---|---|
| `source`, `listing_id`, `watch_id` | TEXT, chave primária composta |
| `title`, `url` | TEXT |
| `first_seen`, `last_seen` | TEXT (ISO) |
| `last_price_cents` | INTEGER NULL |
| `notified_price_cents` | INTEGER NULL |
| `notified_at` | TEXT NULL |

Registros com `last_seen` mais antigo que `retentionDays` são removidos uma vez por hora.

### Notificação Discord

- Cada alerta vira um *embed*: título clicável (link do anúncio), preço em destaque (`R$ 1.100,00`), local, horário do anúncio, nome do produto, miniatura, e etiquetas `NOVO` / `PREÇO BAIXOU de R$ X` / `AGORA DENTRO DO LIMITE` / `Impulsionado`.
- Alertas do mesmo ciclo vão agrupados em mensagens de até 10 embeds.
- Webhook: `watch.webhookEnv` se definido, senão `DISCORD_WEBHOOK_URL`.
- Fila com respeito a limite de taxa: em resposta 429, aguarda `retry_after` e reenvia.
- O anúncio só recebe `notified_price_cents` **depois** do envio confirmado. Se falhar, ele volta naturalmente no próximo ciclo.

## 7. Erros, bloqueios e operação

| Problema | Detecção | Comportamento |
|---|---|---|
| Desafio Cloudflare | título/conteúdo de desafio (`Just a moment`, `Attention Required`, iframe `challenge-platform`) | Pausa **a fonte inteira**; traz a janela para frente; avisa no Discord ("⚠️ OLX pediu verificação, resolva na janela"); verifica a cada 10s **sem recarregar**; ao liberar, avisa "✅ retomado" e continua; lembrete a cada 30 min. Nunca tenta resolver sozinho. Em modo headless/servidor, aplica o recuo abaixo. |
| Bloqueio sem desafio | HTTP 403/429 | Recuo exponencial na fonte: 1, 2, 4, 8, 15 min (teto). Aviso após 3 falhas seguidas e ao recuperar. |
| Timeout / rede | erro de navegação | Tenta no próximo ciclo. Aviso se persistir > 5 min. |
| Layout mudou | página `ok`, mas 0 cards, ou mais da metade dos cards sem preço legível | Aviso único "🛠️ adaptador da OLX pode estar quebrado"; salva HTML + screenshot em `debug/`; continua tentando. |
| Chromium caiu | evento de desconexão | Relança o navegador e reabre as abas. |
| Discord falhou | erro HTTP/rede | Ver seção 6: o anúncio não é marcado e volta no próximo ciclo. |
| Config inválida | erro do zod | Mantém a anterior; avisa no Discord e no log. |

Avisos de vida: "🟢 Rastreador iniciado (N produtos)" ao ligar e "🔴 Rastreador parado" ao encerrar normalmente (SIGINT/SIGTERM).

Os avisos operacionais (bloqueio, layout, config) usam `DISCORD_WEBHOOK_URL` e não se repetem enquanto o estado não mudar.

### Comandos

| Comando | Função |
|---|---|
| `npm start` | Liga o rastreador |
| `npm run check -- <watch-id>` | Busca única a seco: lista aprovados e descartados (com motivo), sem notificar e sem gravar |
| `npm run test-notify` | Envia mensagem de teste ao webhook |
| `npm run capture-fixture -- <watch-id>` | Salva o HTML atual da busca em `tests/fixtures/` |
| `npm test` | Testes automatizados |

### Logs

Uma linha por ciclo (produto, anúncios lidos, aprovados, alertas, duração em ms), no terminal e em `logs/AAAA-MM-DD.log`.

### Implantação

- **PC (agora):** README com passos para iniciar junto com o Windows (Agendador de Tarefas) e evitar suspensão.
- **Servidor (depois):** `Dockerfile` baseado na imagem oficial do Playwright; `data/` como volume; `.env` fora da imagem; Chromium em modo visível sob Xvfb. Aviso no README: IP de datacenter tende a ser mais bloqueado, então a migração é possível, mas sem garantia.

### Estrutura de pastas

```
src/
  config.ts  scheduler.ts  browser.ts  listing.ts  matcher.ts
  decide.ts  store.ts  main.ts  cli/
  sources/olx.ts  sources/index.ts
  notifiers/discord.ts  notifiers/index.ts
tests/
  fixtures/
data/      (ignorado no git)
logs/      (ignorado no git)
debug/     (ignorado no git)
watches.yaml  .env.example  Dockerfile  README.md
```

## 8. Testes

Desenvolvimento com TDD (`vitest`). **Nenhum teste automatizado acessa a OLX ou o Discord reais.**

| Alvo | Cobertura |
|---|---|
| `matcher` | normalização de acentos/maiúsculas/pontuação; remoção de prefixos repetidos; `startsWith` como palavra inteira; alternativas `\|` (incluindo "Nitendo swich lite"); soma de exclusões; limites inclusivos; sem preço; "Switch Lite R$ 950" recusado no produto "demais modelos". **Tabela de títulos reais** (`tests/fixtures/titles.json`, seção 5), com o resultado esperado por produto sem preço e com os pisos de exemplo, incluindo: aprovados "…com Case e Capas", "…Case + Película + Carregador", "Avaliamos Troca"; descartados "Case Nintendo switch LITE", "Capinha psvita 2000", "Controle Sem Fio… Switch Lite", "Jogo… PS Vita", "Yu-Gi-Oh! Rush Duel - Nintendo Switch" |
| `config` | válido/inválido; exatamente um entre `query`/`searchUrl`; `startsWith` obrigatório; mescla de `defaults` (`exclude`, `ignorePrefixes`); recarga inválida mantém a anterior |
| `sources/olx` | `buildUrl` (região, acentos na busca, ordenação por recentes, paginação, `searchUrl`); `extract` contra HTML real salvo em `tests/fixtures/`, carregado no Chromium sem rede; `detectBlock` com fixture de desafio |
| `decide` | um teste por linha da tabela da seção 6 |
| `store` | SQLite em memória: inserir, atualizar, marcar notificado, limpeza por retenção |
| `notifiers/discord` | embed (formato BRL, etiquetas, miniatura); agrupamento em 10; `fetch` falso com 429 + `retry_after`; falha não marca como notificado |
| `scheduler` | relógio simulado: variação dentro do intervalo; um produto por vez; progressão do recuo; pausa/retomada por fonte |
| ponta a ponta | fonte falsa + notifier falso + banco em memória: 1º ciclo notifica, 2º não repete, queda de preço notifica, aumento de teto notifica registro existente |

**Verificação manual antes de concluir:** `npm run check` contra a OLX real conferido com o site; `npm run test-notify` recebido no celular; 15 minutos rodando sem bloqueio.
