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
  exclude: [capa, case, bolsa, pelicula avulsa, defeito, quebrado, pecas,
            sucata, troco, troca, aluguel, procuro, compro, so jogo, caixa vazia]

watches:
  - id: switch-lite
    name: Nintendo Switch Lite
    source: olx
    query: switch lite
    region: brasil
    maxPrice: 800
    minPrice: 300
    include: [lite]

  - id: switch
    name: Nintendo Switch (demais modelos)
    source: olx
    query: nintendo switch
    region: sp
    maxPrice: 1100
    minPrice: 400
    exclude: [lite]

  - id: ps-vita
    name: PS Vita
    source: olx
    query: ps vita
    region: brasil
    maxPrice: 600
    minPrice: 200
    include: ["vita|psvita"]
```

Os valores de preço acima são exemplos. O usuário define os reais.

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
| `include` | não | Termos que **todos** devem aparecer no título; `a\|b` aceita qualquer alternativa |
| `exclude` | não | Termos que descartam o anúncio; somados a `defaults.exclude` |
| `enabled` | não | `false` desativa sem apagar (padrão `true`) |
| `webhookEnv` | não | Nome da variável de ambiente com outro webhook (ex.: um canal por produto) |

\* Exatamente um entre `query` e `searchUrl`.

### Modelagem dos produtos Switch

Switch Lite e os demais Switch (V1, V2, OLED, Switch 2) são **dois produtos com tetos diferentes**. O produto "demais modelos" usa `exclude: [lite]` para que um anúncio de Lite nunca seja avaliado pelo teto maior. O produto Lite usa `include: [lite]`.

### Recarga a quente

O arquivo é observado. Se a nova versão for válida, passa a valer no próximo ciclo de cada produto. Se for inválida, a última config válida é mantida e o erro de validação é enviado ao Discord e ao log. Um produto novo (ou com `id` novo) passa pela leitura inicial de `initialPages` páginas.

## 5. Regras de filtro (`matcher`)

1. **Normalização:** título em minúsculas, sem acentos (NFD + remoção de diacríticos), pontuação trocada por espaço e espaços colapsados. O mesmo vale para os termos da config.
2. **Casamento por palavra/frase inteira:** um termo casa se aparece delimitado por início/fim ou espaço (`case` não casa com `casei`; `pelicula avulsa` casa como frase).
3. **include:** todos os termos precisam casar; um termo com `|` casa se qualquer alternativa casar.
4. **exclude:** se qualquer termo (`defaults.exclude` ∪ `watch.exclude`) casar, o anúncio é descartado.
5. **Preço:** precisa haver preço e `minPrice ≤ preço ≤ maxPrice`. Anúncio sem preço é descartado.
6. Anúncios "Impulsionados" **não** são descartados.
7. O matcher retorna `{ ok: true }` ou `{ ok: false, reason }` (ex.: `exclude:"defeito"`, `price>max`). O motivo é usado pelo comando `check`.

Só o **título** é avaliado. A descrição exigiria abrir cada anúncio, o que multiplicaria as requisições.

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
| `matcher` | normalização de acentos/maiúsculas; palavra inteira (`case` ≠ `casei`); frases; alternativas `\|`; soma de exclusões; limites inclusivos; sem preço; "Switch Lite R$ 950" recusado no produto "demais modelos" |
| `config` | válido/inválido; exatamente um entre `query`/`searchUrl`; mescla de `defaults`; recarga inválida mantém a anterior |
| `sources/olx` | `buildUrl` (região, acentos na busca, ordenação por recentes, paginação, `searchUrl`); `extract` contra HTML real salvo em `tests/fixtures/`, carregado no Chromium sem rede; `detectBlock` com fixture de desafio |
| `decide` | um teste por linha da tabela da seção 6 |
| `store` | SQLite em memória: inserir, atualizar, marcar notificado, limpeza por retenção |
| `notifiers/discord` | embed (formato BRL, etiquetas, miniatura); agrupamento em 10; `fetch` falso com 429 + `retry_after`; falha não marca como notificado |
| `scheduler` | relógio simulado: variação dentro do intervalo; um produto por vez; progressão do recuo; pausa/retomada por fonte |
| ponta a ponta | fonte falsa + notifier falso + banco em memória: 1º ciclo notifica, 2º não repete, queda de preço notifica, aumento de teto notifica registro existente |

**Verificação manual antes de concluir:** `npm run check` contra a OLX real conferido com o site; `npm run test-notify` recebido no celular; 15 minutos rodando sem bloqueio.
