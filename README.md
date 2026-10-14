# Rastreador de Produtos

Avisa no Discord, em segundos, quando aparece na OLX um anúncio **comprável agora** (botão "Comprar" com Garantia da OLX) de um produto que você monitora, com preço dentro do seu limite.

Começa com PS Vita, Nintendo Switch e Switch Lite, mas qualquer produto pode ser adicionado editando `watches.yaml`.

## Instalação (Windows)

1. Instale o Node.js 24 LTS: https://nodejs.org
2. Na pasta do projeto:
   ```bash
   npm install
   npx playwright install chromium
   ```
3. Crie o webhook no Discord:
   - Crie um servidor só seu (botão "+" → "Criar o meu") e um canal, por exemplo `#alertas`.
   - Editar canal → Integrações → Webhooks → Novo webhook → **Copiar URL do webhook**.
   - No app do celular, deixe o canal em **Notificações → Todas as mensagens**.
4. Copie `.env.example` para `.env` e cole a URL em `DISCORD_WEBHOOK_URL`.
5. Teste:
   ```bash
   npm run test-notify
   ```
   Deve chegar uma mensagem e um alerta de exemplo no celular.

## Configurar produtos (`watches.yaml`)

Cada item em `watches` é um produto. Campos principais:

| Campo | O que faz |
|---|---|
| `query` | texto da busca na OLX |
| `region` | `brasil`, `go` ou `go/grande-goiania-e-anapolis` |
| `maxPrice` / `minPrice` | faixa de preço em reais (inclusiva). O mínimo corta jogos e acessórios baratos. |
| `startsWith` | o título precisa **começar** com uma destas formas (`a\|b` = alternativas). É o que separa "Switch Lite com case" (aprovado) de "Case para Switch Lite" (recusado). |
| `exclude` | palavras que descartam o anúncio (somadas às de `defaults`) |
| `pickupCities` | cidades onde você aceita retirada em mãos; fora delas, só com entrega |
| `enabled: false` | pausa o produto sem apagar |

O arquivo é recarregado sozinho ao salvar. Se ficar inválido, o rastreador mantém a versão anterior e avisa no Discord o que está errado.

Só anúncios **compráveis imediatamente** geram alerta. Anúncios em que é preciso "Solicitar" ao vendedor são sempre ignorados (regra fixa).

### Calibrar filtros

```bash
npm run check -- switch-lite
```

Faz uma busca real e lista cada anúncio com ✅ ou ❌ e o motivo (`startsWith`, `exclude:"defeito"`, `price>max`, `not-buyable`...). Não notifica nem grava nada, e pode rodar com o rastreador ligado.

## Rodar

```bash
npm start
```

- Abre uma janela do Chromium (pode minimizar, **não feche**).
- Cada produto é consultado a cada 25–40 segundos.
- Na primeira vez, lê as 3 primeiras páginas e avisa o que já existe dentro das regras. Depois, só anúncios novos ou que baixaram de preço.
- Se a OLX pedir verificação ("sou humano"), você recebe um aviso no Discord. Resolva na janela do rastreador e ele continua sozinho.
- Logs em `logs/AAAA-MM-DD.log`.
- `Ctrl+C` encerra e avisa "🔴 Rastreador parado".
- Se aparecer "🔴 Rastreador caiu", o processo encerrou e **não se reinicia sozinho**: reabra com `iniciar.bat` (ou espere o próximo logon, se usa a tarefa agendada).

### Iniciar junto com o Windows

1. Abra o **Prompt de Comando (cmd)**, não o PowerShell, e rode (ajuste o caminho se mudou a pasta):
   ```bat
   schtasks /Create /TN "Rastreador de Produtos" /TR "\"D:\Projetos\Rastreador videogame\iniciar.bat\"" /SC ONLOGON
   ```
   Se o `schtasks` recusar (acesso negado), abra o **cmd como administrador** (botão direito → "Executar como administrador") e rode de novo.
2. Evite que o PC entre em suspensão: Configurações → Sistema → Energia → "Suspender" → **Nunca** (na tomada).

## Avisos que você pode receber

| Aviso | Significado |
|---|---|
| ⚠️ pediu verificação | resolva na janela do navegador do rastreador |
| ⏰ ainda está pedindo verificação | lembrete: a verificação continua sem ser resolvida na janela do navegador |
| ℹ️ a aba foi fechada durante a verificação | você fechou a aba do desafio; o rastreador retomou e, se o pedido continuar, avisa de novo |
| ⛔ bloqueando as consultas | a OLX recusou várias vezes; ele tenta de novo com intervalos maiores (até 15 min) |
| 🛠️ adaptador pode estar quebrado | a OLX mudou a página; snapshot salvo em `debug/` para correção |
| 📡 não consigo acessar | sem internet ou OLX fora do ar há mais de 5 min |
| ⚠️ watches.yaml inválido | você salvou o arquivo com erro; o rastreador mantém a versão anterior e mostra o que corrigir |
| ⚠️ Erro inesperado no produto / no laço principal | falha interna num ciclo; ele continua rodando e avisa de novo só se o estado mudar |
| 🔴 Rastreador caiu: … | falha fatal: o processo **encerrou** e **não se reinicia sozinho**. Reabra com `iniciar.bat` (ou espere o próximo logon, se usa a tarefa agendada) e veja o motivo em `logs/` |
| ✅ … (verificação resolvida, conexão restabelecida, voltou a responder, leitura normalizada, produto/laço normalizado) | o problema avisado antes passou |

## Servidor (Docker)

```bash
docker build -t rastreador .
docker run -d --name rastreador --restart unless-stopped --init --ipc=host --env-file .env -v ./data:/app/data -v ./logs:/app/logs -v ./watches.yaml:/app/watches.yaml rastreador
```

Observações:

- IPs de datacenter costumam ser mais bloqueados pela OLX. A migração é possível, mas sem garantia de funcionar tão bem quanto no PC de casa.
- No servidor ninguém resolve verificações ("sou humano"). Use `headless: true` em `settings` no `watches.yaml` do servidor: nesse modo um desafio é tratado como bloqueio e entra no recuo automático (tenta de novo com intervalos maiores, até 15 min, e avisa com ⛔ depois de 3 falhas seguidas), em vez de ficar esperando alguém na janela.
- `--init` e `--ipc=host` evitam processos zumbis e quedas do Chromium por falta de memória compartilhada.

## Quando a OLX mudar o layout

```bash
npm run capture-fixture -- switch-lite
npm test
```

O teste `olx-real-fixture` passa a falhar com a página nova. Corrija `src/sources/olx.ts` até ele passar de novo.

## Desenvolvimento

```bash
npm test          # testes (nenhum acessa OLX/Discord)
npm run typecheck
```
