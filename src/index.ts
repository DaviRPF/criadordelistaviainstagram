import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { ProspectorScraper } from './scraper';
import { InstagramAuth } from './instagram-auth';
import { EconodataAuth } from './econodata-auth';
import { PlanilhaProcessor } from './planilha-processor';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3123;

// Configurar multer para upload de arquivos
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream' // fallback
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos Excel (.xlsx, .xls) são permitidos'));
    }
  }
});

app.use(express.json());
app.use(express.static('public'));

// Instâncias globais de autenticação
const instagramAuth = new InstagramAuth();
const econodataAuth = new EconodataAuth();

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

// Rota para verificar se está logado no Instagram
app.get('/api/verificar-login', (req, res) => {
  res.json({
    logado: instagramAuth.estaLogado()
  });
});

// Rota para fazer login no Econodata
app.post('/api/login-econodata', async (req, res) => {
  console.log('');
  console.log('🔐 Abrindo navegador para login manual no Econodata...');

  try {
    await econodataAuth.fazerLoginManual();

    console.log('✅ Login no Econodata realizado com sucesso!');
    res.json({
      sucesso: true
    });

  } catch (error: any) {
    console.error('❌ Erro ao fazer login no Econodata:', error.message);
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

// Rota para verificar se está logado no Econodata
app.get('/api/verificar-login-econodata', (req, res) => {
  res.json({
    logado: econodataAuth.estaLogado()
  });
});

// Rota para importar cache de CSV/JSON
app.post('/api/importar-cache', async (req, res) => {
  try {
    const { usernames } = req.body;

    if (!usernames || !Array.isArray(usernames)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Formato inválido. Envie um array de usernames.'
      });
    }

    // Criar scraper temporário só para importar
    const scraper = new ProspectorScraper({
      tipoEstabelecimento: '',
      cidade: '',
      geminiApiKey: process.env.GEMINI_API_KEY!,
      geminiModel: 'gemini-2.5-flash',
      twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY!,
      instagramAuth,
      econodataAuth
    });

    const novos = scraper.importarCache(usernames);

    console.log(`📥 Cache importado: ${novos} novos usernames`);

    res.json({
      sucesso: true,
      novos,
      total: scraper.getEstatisticasCache().total
    });

  } catch (error: any) {
    console.error('❌ Erro ao importar cache:', error.message);
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

// Rota para iniciar o scraping com SSE (Server-Sent Events)
app.post('/api/iniciar-prospeccao', async (req, res) => {
  const { tipoEstabelecimento, cidade, limite, modeloIA, pularProcessadas } = req.body;

  console.log('');
  console.log('📊 Nova requisição de prospecção recebida:');
  console.log('  Tipo de Estabelecimento:', tipoEstabelecimento);
  console.log('  Cidade:', cidade);
  console.log('  Limite:', limite || 'Sem limite');
  console.log('  Modelo IA:', modeloIA);
  console.log('  Pular Processadas:', pularProcessadas ? 'Sim' : 'Não');
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
      geminiModel: modeloIA || 'gemini-2.5-flash',
      twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY!,
      instagramAuth,
      econodataAuth,
      pularProcessadas: pularProcessadas === true,
      onProgresso: (resultado, atual, total) => {
        enviarEvento('progresso', { resultado, atual, total });
      },
      onEstatisticas: (puladas, novas) => {
        enviarEvento('estatisticas', { puladas, novas });
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

// Rota para processar planilha de empresas
app.post('/api/processar-planilha', upload.single('planilha'), async (req, res) => {
  console.log('');
  console.log('📊 Nova requisição de processamento de planilha recebida');

  if (!req.file) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Nenhum arquivo enviado'
    });
  }

  const modeloIA = req.body.modeloIA || 'gemini-2.5-flash';

  console.log('  Arquivo:', req.file.originalname);
  console.log('  Tamanho:', (req.file.size / 1024).toFixed(2), 'KB');
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
    const processor = new PlanilhaProcessor({
      geminiApiKey: process.env.GEMINI_API_KEY!,
      geminiModel: modeloIA,
      twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY!,
      instagramAuth,
      onProgresso: (resultado, atual, total) => {
        enviarEvento('progresso', { resultado, atual, total });
      }
    });

    // Ler planilha
    const empresas = processor.lerPlanilha(req.file.buffer);
    enviarEvento('info', { total: empresas.length, mensagem: `${empresas.length} empresas encontradas na planilha` });

    // Processar
    const resultados = await processor.executar(empresas);

    enviarEvento('concluido', { resultados });
    res.end();

  } catch (error: any) {
    console.error('❌ Erro durante o processamento:', error.message);
    enviarEvento('erro', { erro: error.message });
    res.end();
  }
});

// Rota para preview da planilha (sem processar)
app.post('/api/preview-planilha', upload.single('planilha'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Nenhum arquivo enviado'
    });
  }

  try {
    const processor = new PlanilhaProcessor({
      geminiApiKey: process.env.GEMINI_API_KEY!,
      geminiModel: 'gemini-2.5-flash',
      twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY!,
      instagramAuth
    });

    const empresas = processor.lerPlanilha(req.file.buffer);

    // Retornar preview (primeiras 10 empresas)
    res.json({
      sucesso: true,
      total: empresas.length,
      preview: empresas.slice(0, 10),
      colunas: Object.keys(empresas[0] || {})
    });

  } catch (error: any) {
    console.error('❌ Erro ao fazer preview:', error.message);
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
  console.log('');
  console.log('💡 Acesse o navegador e comece a prospectar!');
  console.log('====================================');
  console.log('');
});
