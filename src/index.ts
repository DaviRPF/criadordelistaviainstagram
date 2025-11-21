import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { ProspectorScraper } from './scraper';
import { InstagramAuth } from './instagram-auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Instância global de autenticação
const instagramAuth = new InstagramAuth();

// Logger de inicialização
console.log('====================================');
console.log('🚀 Iniciando Criador de Lista via Instagram');
console.log('====================================');
console.log('📅 Data/Hora:', new Date().toLocaleString('pt-BR'));
console.log('');
console.log('🔑 Verificando API Keys:');
console.log('  GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Configurada' : '❌ NÃO ENCONTRADA');
console.log('  TWOCAPTCHA_API_KEY:', process.env.TWOCAPTCHA_API_KEY ? '✅ Configurada' : '❌ NÃO ENCONTRADA');
console.log('');

if (!process.env.GEMINI_API_KEY) {
  console.log('⚠️  AVISO: GEMINI_API_KEY não configurada. Crie um arquivo .env baseado no .env.example');
}
if (!process.env.TWOCAPTCHA_API_KEY) {
  console.log('⚠️  AVISO: TWOCAPTCHA_API_KEY não configurada. Crie um arquivo .env baseado no .env.example');
}

console.log('');
console.log('====================================');
console.log('');

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Rota para fazer login no Instagram
app.post('/api/login-instagram', async (req, res) => {
  console.log('');
  console.log('🔐 Abrindo navegador para login manual...');

  try {
    await instagramAuth.fazerLoginManual();

    console.log('✅ Login realizado com sucesso!');
    res.json({
      sucesso: true
    });

  } catch (error: any) {
    console.error('❌ Erro ao fazer login:', error.message);
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

// Rota para verificar se está logado
app.get('/api/verificar-login', (req, res) => {
  res.json({
    logado: instagramAuth.estaLogado()
  });
});

// Rota para iniciar o scraping com SSE (Server-Sent Events)
app.post('/api/iniciar-prospeccao', async (req, res) => {
  const { tipoEstabelecimento, cidade, limite, modeloIA } = req.body;

  console.log('');
  console.log('📊 Nova requisição de prospecção recebida:');
  console.log('  Tipo de Estabelecimento:', tipoEstabelecimento);
  console.log('  Cidade:', cidade);
  console.log('  Limite:', limite || 'Sem limite');
  console.log('  Modelo IA:', modeloIA);
  console.log('');

  // Configurar SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const enviarEvento = (tipo: string, dados: any) => {
    res.write(`data: ${JSON.stringify({ tipo, dados })}\n\n`);
  };

  try {
    const scraper = new ProspectorScraper({
      tipoEstabelecimento,
      cidade,
      limite: limite ? parseInt(limite) : undefined,
      geminiApiKey: process.env.GEMINI_API_KEY!,
      geminiModel: modeloIA || 'gemini-2.5-flash-preview-05',
      twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY!,
      instagramAuth,
      onProgresso: (resultado, atual, total) => {
        enviarEvento('progresso', { resultado, atual, total });
      }
    });

    const resultados = await scraper.executar();

    enviarEvento('concluido', { resultados });
    res.end();

  } catch (error: any) {
    console.error('❌ Erro durante a prospecção:', error.message);
    enviarEvento('erro', { erro: error.message });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
  console.log('');
  console.log('💡 Acesse o navegador e comece a prospectar!');
  console.log('====================================');
  console.log('');
});
