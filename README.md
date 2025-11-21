# 🔍 Criador de Lista via Instagram

Sistema automatizado de prospecção de empresas via Instagram usando Puppeteer, IA Gemini e resolução de CAPTCHAs.

## 📋 Funcionalidades

- ✅ Busca automatizada no Google por tipo de estabelecimento + cidade
- ✅ Detecção e resolução automática de CAPTCHAs via 2Captcha
- ✅ Scraping de perfis do Instagram
- ✅ Extração de nome, username e contatos (telefone/WhatsApp) da bio
- ✅ Validação inteligente usando IA Gemini
- ✅ Busca automática de dados de CNPJ (Econodata e CNPJBiz)
- ✅ Navegação automática entre páginas de resultados
- ✅ Interface web moderna e responsiva
- ✅ Logs detalhados de todo o processo

## 🛠️ Tecnologias

- **Node.js** + **TypeScript**
- **Puppeteer** - Automação de navegador
- **Express** - Servidor web
- **Gemini AI** - Validações inteligentes
- **2Captcha** - Resolução de CAPTCHAs

## 📦 Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/DaviRPF/criadordelistaviainstagram.git
cd criadordelistaviainstagram
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as API Keys

Copie o arquivo `.env.example` para `.env`:

```bash
cp .env.example .env
```

Edite o arquivo `.env` e adicione suas chaves:

```env
# API Keys
GEMINI_API_KEY=sua_chave_gemini_aqui
TWOCAPTCHA_API_KEY=sua_chave_2captcha_aqui

# Configurações
PORT=3000
```

#### Onde obter as API Keys:

- **Gemini API**: https://makersuite.google.com/app/apikey
- **2Captcha API**: https://2captcha.com/enterpage

## 🚀 Como Usar

### Modo Desenvolvimento

```bash
npm run dev
```

O servidor estará rodando em: http://localhost:3000

### Modo Produção

```bash
npm run build
npm start
```

## 💡 Como Funciona

### 1. Interface Web

Acesse http://localhost:3000 e preencha:

- **Tipo de Estabelecimento**: Pizzaria, Academia, Clínica Odontológica, etc.
- **Cidade**: São Paulo, Rio de Janeiro, etc.
- **Limite de Contas** (opcional): Número máximo de perfis para buscar

### 2. Processo de Scraping

1. 🔍 **Busca no Google**: `{tipo} {cidade} instagram`
2. 🔐 **Detecção de CAPTCHA**: Resolve automaticamente se necessário
3. 📄 **Análise de Resultados**: IA valida se é perfil do Instagram
4. 📱 **Scraping Instagram**: Extrai nome, username e bio
5. 🤖 **IA Gemini**:
   - Identifica nome real do estabelecimento
   - Extrai telefone/WhatsApp da bio
6. 🏢 **Busca CNPJ**: Procura no Econodata ou CNPJBiz
   - Situação da empresa
   - Data de abertura
   - Tipo de unidade
   - Porte
   - Sócios e administradores
7. ⏭️ **Paginação**: Continua para próxima página se necessário

### 3. Resultados

Os resultados são exibidos em uma tabela com:

- Nome do estabelecimento
- Username do Instagram
- Link para o perfil
- Telefone/WhatsApp (se encontrado)
- Link para dados de CNPJ
- Informações da empresa

## 📊 Logs Detalhados

O sistema exibe logs completos no console, incluindo:

```
====================================
🚀 Iniciando Criador de Lista via Instagram
====================================
📅 Data/Hora: 21/11/2025 00:00:00

🔑 Verificando API Keys:
  GEMINI_API_KEY: ✅ Configurada
  TWOCAPTCHA_API_KEY: ✅ Configurada

====================================

✅ Servidor rodando em http://localhost:3000

📊 Nova requisição de prospecção recebida:
  Tipo de Estabelecimento: Pizzaria
  Cidade: São Paulo
  Limite: 10

🌐 Iniciando navegador Puppeteer...
✅ Navegador iniciado com sucesso

🔍 Buscando no Google:
  Termo: "Pizzaria São Paulo instagram"

🔐 Verificando presença de CAPTCHA...
✅ Nenhum CAPTCHA detectado

📄 Processando resultados da busca...
  🔎 Analisando: Pizzaria Bella Napoli (@bellanapolipizza)
     🤖 IA respondeu: SIM
     ✅ É do Instagram! Processando...
```

## ⚙️ Estrutura do Projeto

```
criadordelistaviainstagram/
├── src/
│   ├── index.ts          # Servidor Express
│   └── scraper.ts        # Lógica de scraping
├── public/
│   └── index.html        # Interface web
├── .env.example          # Exemplo de configuração
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Configurações Avançadas

### Alterar o modo do navegador

No arquivo `src/scraper.ts`, linha ~62:

```typescript
this.browser = await puppeteer.launch({
  headless: false, // false = mostra o navegador | true = invisível
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled'
  ]
});
```

### Ajustar timeouts

Os timeouts podem ser ajustados nas chamadas de `page.waitForNavigation()`:

```typescript
await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
```

## 🐛 Solução de Problemas

### Erro de API Key não configurada

```
⚠️  AVISO: GEMINI_API_KEY não configurada
```

**Solução**: Crie o arquivo `.env` baseado no `.env.example` e adicione suas chaves.

### Erro ao baixar Puppeteer

```bash
# Use esta variável para pular o download
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

### CAPTCHA não sendo resolvido

Verifique se:
1. A API key do 2Captcha está correta
2. Você tem créditos suficientes na conta 2Captcha

## 📝 Licença

ISC

## 👨‍💻 Autor

Desenvolvido com ❤️ para prospecção automatizada de empresas.
