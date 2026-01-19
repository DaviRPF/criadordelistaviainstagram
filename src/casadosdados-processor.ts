import puppeteer, { Browser, Page } from 'puppeteer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CasaDadosAuth } from './casadosdados-auth';
import { InstagramAuth } from './instagram-auth';
import path from 'path';

interface CasaDadosConfig {
  urlPesquisa: string;
  geminiApiKeys: string[]; // Array de API keys para processamento paralelo
  geminiModel: string;
  limite?: number;
  processosParalelos?: number; // Quantos processos por API key (default: 2)
  casaDadosAuth?: CasaDadosAuth;
  instagramAuth?: InstagramAuth;
  onProgresso?: (resultado: EmpresaCasaDados, atual: number, total: number) => void;
}

export interface EmpresaCasaDados {
  // Dados basicos do CNPJ
  razaoSocial?: string;
  nomeFantasia?: string;
  cnpj?: string;

  // Situacao
  situacaoCadastral?: string;
  dataAbertura?: string;
  dataSituacao?: string;
  motivoSituacao?: string;

  // Natureza
  naturezaJuridica?: string;
  porte?: string;
  capitalSocial?: string;
  empresaMEI?: boolean;
  simples?: boolean;

  // Endereco
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;

  // Contato do CNPJ
  telefoneCNPJ?: string;
  emailCNPJ?: string;

  // CNAE
  cnaePrincipal?: string;
  descricaoCnaePrincipal?: string;
  cnaesSecundarios?: string[];

  // Socios
  socios?: Array<{
    nome: string;
    qualificacao?: string;
    dataEntrada?: string;
  }>;

  // Instagram
  instagramUrl?: string;
  instagramUsername?: string;
  instagramBio?: string;
  whatsappBio?: string;
  numeroWhatsappBio?: string;
  linkTree?: string;
  siteProprio?: string;
  siteProprioLinktree?: string;
  whatsappLinkTree?: string;
  numeroWhatsappLinkTree?: string;

  // Google Meu Negocio
  linkGMB?: string;
  telefoneGMB?: string;
  telefoneGMBTemWhatsApp?: boolean;
  horarioFuncionamento?: string;

  // Link original
  urlEmpresa?: string;
}

// Interface para worker de processamento paralelo
interface Worker {
  id: number;
  gemini: GoogleGenerativeAI;
  apiKeyIndex: number;
  ocupado: boolean;
}

export class CasaDadosProcessor {
  private config: CasaDadosConfig;
  private browser: Browser | null = null;
  private workers: Worker[] = [];
  private gemini: GoogleGenerativeAI; // Instancia padrao para compatibilidade
  private resultados: EmpresaCasaDados[] = [];
  private urlsProcessadas: Set<string> = new Set();
  private empresasProcessadas: number = 0;
  private totalEmpresas: number = 0;

  constructor(config: CasaDadosConfig) {
    this.config = config;

    // Criar instancia padrao de Gemini (usando primeira API key)
    this.gemini = new GoogleGenerativeAI(config.geminiApiKeys[0]);

    // Criar workers com as API keys (2 workers por key por padrão)
    const processosPorKey = config.processosParalelos || 2;
    let workerId = 0;

    for (let keyIndex = 0; keyIndex < config.geminiApiKeys.length; keyIndex++) {
      const apiKey = config.geminiApiKeys[keyIndex];
      for (let i = 0; i < processosPorKey; i++) {
        this.workers.push({
          id: workerId++,
          gemini: new GoogleGenerativeAI(apiKey),
          apiKeyIndex: keyIndex,
          ocupado: false
        });
      }
    }

    console.log('Casa dos Dados Processor iniciado (MODO PARALELO)');
    console.log('  URL:', config.urlPesquisa);
    console.log('  Limite:', config.limite || 'Sem limite');
    console.log('  API Keys:', config.geminiApiKeys.length);
    console.log('  Workers totais:', this.workers.length);
    console.log('  Processos por key:', processosPorKey);
  }

  async executar(): Promise<EmpresaCasaDados[]> {
    try {
      console.log('');
      console.log('Iniciando extracao do Casa dos Dados...');
      console.log('====================================');

      await this.iniciarBrowser();
      await this.processarPesquisa();
      await this.fecharBrowser();

      console.log('');
      console.log('Extracao concluida!');
      console.log(`Total de empresas: ${this.resultados.length}`);
      console.log('====================================');

      return this.resultados;

    } catch (error: any) {
      console.error('Erro fatal no processador:', error.message);
      await this.fecharBrowser();
      throw error;
    }
  }

  private async iniciarBrowser(): Promise<void> {
    console.log('');
    console.log('Iniciando navegador...');

    this.browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    console.log('Navegador iniciado');
  }

  private async fecharBrowser(): Promise<void> {
    if (this.browser) {
      console.log('');
      console.log('Fechando navegador...');
      await this.browser.close();
      console.log('Navegador fechado');
    }
  }

  private async chamarIAComRetry(prompt: string, maxTentativas: number = 5): Promise<string> {
    const model = this.gemini.getGenerativeModel({ model: this.config.geminiModel });

    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
      try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
      } catch (error: any) {
        const mensagemErro = error.message || String(error);

        if (mensagemErro.includes('429') || mensagemErro.includes('Too Many Requests') || mensagemErro.includes('quota')) {
          if (tentativa < maxTentativas) {
            const tempoEspera = Math.pow(2, tentativa) * 1000;
            console.log(`  Rate limit. Aguardando ${tempoEspera/1000}s (tentativa ${tentativa}/${maxTentativas})...`);
            await new Promise(resolve => setTimeout(resolve, tempoEspera));
            continue;
          }
        }
        throw error;
      }
    }

    throw new Error('Numero maximo de tentativas excedido');
  }

  private async processarPesquisa(): Promise<void> {
    if (!this.browser) throw new Error('Browser nao iniciado');

    const page = await this.browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Aplicar cookies de autenticacao se disponivel
    if (this.config.casaDadosAuth) {
      await this.config.casaDadosAuth.aplicarCookies(page);
    }

    console.log('');
    console.log('Acessando URL da pesquisa...');
    console.log(`URL: ${this.config.urlPesquisa}`);

    await page.goto(this.config.urlPesquisa, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Pagina carregada');

    // Esperar a pagina carregar completamente
    await page.waitForTimeout(3000);

    // Clicar no botao de pesquisa para carregar os resultados
    console.log('Clicando no botao de pesquisa...');
    const clicouPesquisa = await this.clicarBotaoPesquisa(page);

    if (clicouPesquisa) {
      console.log('Botao de pesquisa clicado, aguardando resultados...');
      await page.waitForTimeout(5000);
    } else {
      console.log('Botao de pesquisa nao encontrado automaticamente.');
    }

    // Verificar se tem resultados, se nao tiver, aguardar clique manual
    let temResultados = await this.verificarResultados(page);

    if (!temResultados) {
      console.log('');
      console.log('========================================');
      console.log('ATENCAO: Resultados nao detectados!');
      console.log('Por favor, clique no botao de pesquisa manualmente.');
      console.log('Aguardando ate 60 segundos...');
      console.log('========================================');
      console.log('');

      const inicioEspera = Date.now();
      const tempoMaximo = 60000;

      while (!temResultados && (Date.now() - inicioEspera) < tempoMaximo) {
        await page.waitForTimeout(2000);
        temResultados = await this.verificarResultados(page);

        if (!temResultados) {
          const tempoRestante = Math.ceil((tempoMaximo - (Date.now() - inicioEspera)) / 1000);
          console.log(`  Aguardando resultados... (${tempoRestante}s restantes)`);
        }
      }

      if (!temResultados) {
        console.log('');
        console.log('Tempo esgotado. Tentando extrair dados mesmo assim...');
      } else {
        console.log('');
        console.log('Resultados detectados! Continuando...');
      }
    }

    this.empresasProcessadas = 0;
    let paginaAtual = 1;

    while (true) {
      console.log('');
      console.log(`Processando pagina ${paginaAtual}...`);

      // Extrair links das empresas ATIVAS na pagina atual
      const linksEmpresas = await this.extrairLinksEmpresasAtivas(page);

      if (linksEmpresas.length === 0) {
        console.log('Nenhuma empresa ATIVA encontrada nesta pagina');
        break;
      }

      console.log(`Encontradas ${linksEmpresas.length} empresas ATIVAS nesta pagina`);

      // Filtrar empresas que ja foram processadas
      const empresasNovas = linksEmpresas.filter(emp => !this.urlsProcessadas.has(emp.url));
      const empresasRepetidas = linksEmpresas.length - empresasNovas.length;

      if (empresasRepetidas > 0) {
        console.log(`  ⚠️ ${empresasRepetidas} empresas ja processadas anteriormente (ignorando)`);
      }

      // Se TODAS as empresas da pagina ja foram processadas, provavelmente voltamos para uma pagina anterior
      if (empresasNovas.length === 0) {
        console.log('');
        console.log('========================================');
        console.log('⚠️ TODAS as empresas desta pagina ja foram processadas!');
        console.log('   Provavelmente a paginacao voltou ao inicio.');
        console.log('   Finalizando para evitar loop infinito.');
        console.log('========================================');
        break;
      }

      console.log(`  ${empresasNovas.length} empresas novas para processar`);

      // Marcar todas como processadas para evitar duplicatas
      empresasNovas.forEach(emp => this.urlsProcessadas.add(emp.url));

      // Calcular total considerando limite
      const empresasParaProcessar = this.config.limite
        ? empresasNovas.slice(0, this.config.limite - this.empresasProcessadas)
        : empresasNovas;

      if (empresasParaProcessar.length === 0) {
        console.log(`Limite de ${this.config.limite} empresas atingido`);
        await page.close();
        return;
      }

      this.totalEmpresas = this.config.limite || (this.empresasProcessadas + empresasParaProcessar.length);

      // ========================================
      // PROCESSAMENTO PARALELO
      // ========================================
      console.log('');
      console.log(`🚀 Iniciando processamento PARALELO de ${empresasParaProcessar.length} empresas com ${this.workers.length} workers...`);

      await this.processarEmParalelo(empresasParaProcessar);

      console.log('');
      console.log(`✅ Pagina ${paginaAtual} concluida. Total processado: ${this.empresasProcessadas}`);

      // Verificar se atingiu limite
      if (this.config.limite && this.empresasProcessadas >= this.config.limite) {
        console.log(`Limite de ${this.config.limite} empresas atingido`);
        await page.close();
        return;
      }

      // Tentar ir para proxima pagina
      const temProximaPagina = await this.irParaProximaPagina(page);
      if (!temProximaPagina) {
        console.log('Nao ha mais paginas');
        break;
      }

      paginaAtual++;
      await page.waitForTimeout(2000);
    }

    await page.close();
  }

  private async extrairLinksEmpresasAtivas(page: Page): Promise<Array<{ url: string; razaoSocial?: string }>> {
    console.log('  Extraindo lista de empresas ATIVAS...');

    const links = await page.evaluate(() => {
      const resultados: Array<{ url: string; razaoSocial?: string; situacao?: string }> = [];

      // Tentar encontrar elementos que contenham informacao de empresa
      // Procurar por linhas de tabela ou cards que tenham "ATIVA"
      const todosElementos = document.querySelectorAll('tr, .card, .list-item, [class*="result"], [class*="empresa"], div[class*="row"]');

      todosElementos.forEach(el => {
        const texto = el.textContent || '';

        // Verificar se esse elemento menciona "ATIVA"
        if (texto.toUpperCase().includes('ATIVA') && !texto.toUpperCase().includes('INATIVA') && !texto.toUpperCase().includes('BAIXADA')) {
          // Procurar link dentro deste elemento
          const link = el.querySelector('a[href*="/empresa/"]') || el.querySelector('a[href*="cnpj"]');
          if (link) {
            const href = (link as HTMLAnchorElement).href;
            const razaoSocial = link.textContent?.trim().substring(0, 100) || '';
            resultados.push({ url: href, razaoSocial, situacao: 'ATIVA' });
          }
        }
      });

      // Se nao encontrou com o metodo acima, tentar extrair todos os links de empresas
      if (resultados.length === 0) {
        const todosLinks = document.querySelectorAll('a[href*="/empresa/"], a[href*="cnpj"]');
        todosLinks.forEach(link => {
          const href = (link as HTMLAnchorElement).href;
          const texto = link.textContent?.trim() || '';
          // Verificar se o contexto menciona ATIVA
          const parent = link.closest('tr, .card, div');
          const contexto = parent?.textContent || '';
          if (contexto.toUpperCase().includes('ATIVA') && !contexto.toUpperCase().includes('INATIVA')) {
            resultados.push({ url: href, razaoSocial: texto.substring(0, 100), situacao: 'ATIVA' });
          }
        });
      }

      return resultados;
    });

    // Remover duplicatas
    const linksUnicos = links.filter((link, index, self) =>
      index === self.findIndex(l => l.url === link.url)
    );

    console.log(`  ${linksUnicos.length} empresas ATIVAS encontradas`);
    return linksUnicos;
  }

  // ========================================
  // PROCESSAMENTO PARALELO
  // ========================================

  private async processarEmParalelo(empresas: Array<{ url: string; razaoSocial?: string }>): Promise<void> {
    // Criar uma fila de empresas para processar
    const fila = [...empresas];
    const promessasAtivas: Promise<void>[] = [];

    // Funcao que processa uma empresa usando um worker especifico
    const processarComWorker = async (worker: Worker): Promise<void> => {
      while (fila.length > 0) {
        const empresa = fila.shift();
        if (!empresa) break;

        worker.ocupado = true;
        this.empresasProcessadas++;
        const numeroEmpresa = this.empresasProcessadas;

        console.log(`[Worker ${worker.id}] === Empresa ${numeroEmpresa}${this.config.limite ? ` de ${this.config.limite}` : ''} ===`);
        console.log(`[Worker ${worker.id}] Nome: ${empresa.razaoSocial || 'N/A'}`);

        try {
          // 1. Extrair dados da pagina do Casa dos Dados
          const dadosEmpresa = await this.extrairDadosEmpresaWorker(empresa.url, worker);

          if (dadosEmpresa) {
            // Montar localizacao completa (cidade + estado)
            const localizacao = [dadosEmpresa.municipio, dadosEmpresa.uf].filter(Boolean).join(' ');

            // 2. Buscar no Google Meu Negocio
            const termoBuscaGMB = `${dadosEmpresa.nomeFantasia || dadosEmpresa.razaoSocial} ${localizacao}`;
            console.log(`[Worker ${worker.id}]   Buscando GMB: "${termoBuscaGMB}"`);
            const dadosGMB = await this.buscarGoogleMeuNegocioWorker(termoBuscaGMB, worker);

            // 3. Buscar Instagram
            const termoBuscaInsta = `${dadosEmpresa.nomeFantasia || dadosEmpresa.razaoSocial} ${localizacao} instagram`;
            console.log(`[Worker ${worker.id}]   Buscando Instagram: "${termoBuscaInsta}"`);
            const dadosInstagram = await this.buscarInstagramWorker(termoBuscaInsta, dadosEmpresa.municipio, worker);

            // Combinar todos os dados
            const resultadoCompleto: EmpresaCasaDados = {
              ...dadosEmpresa,
              ...dadosGMB,
              ...dadosInstagram
            };

            this.resultados.push(resultadoCompleto);

            if (this.config.onProgresso) {
              this.config.onProgresso(resultadoCompleto, numeroEmpresa, this.totalEmpresas);
            }

            console.log(`[Worker ${worker.id}] ✅ Empresa ${numeroEmpresa} concluida`);
          }
        } catch (error: any) {
          console.error(`[Worker ${worker.id}] ❌ Erro ao processar empresa: ${error.message}`);
        }

        worker.ocupado = false;

        // Pequena pausa para nao sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    };

    // Iniciar todos os workers em paralelo
    for (const worker of this.workers) {
      promessasAtivas.push(processarComWorker(worker));
    }

    // Aguardar todos os workers terminarem
    await Promise.all(promessasAtivas);
  }

  // Versao do extrairDadosEmpresa que usa um worker especifico
  private async extrairDadosEmpresaWorker(url: string, worker: Worker): Promise<EmpresaCasaDados | null> {
    if (!this.browser) return null;

    console.log(`[Worker ${worker.id}]   Acessando: ${url}`);

    const page = await this.browser.newPage();

    try {
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      if (this.config.casaDadosAuth) {
        await this.config.casaDadosAuth.aplicarCookies(page);
      }

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Extrair HTML da pagina
      const html = await page.content();

      // Usar Gemini do worker para extrair dados
      const model = worker.gemini.getGenerativeModel({ model: this.config.geminiModel });

      const prompt = `Analise este HTML de uma pagina do Casa dos Dados e extraia as informacoes da empresa.
Retorne APENAS um JSON valido (sem markdown, sem comentarios) com os campos:
- razaoSocial, nomeFantasia, cnpj
- situacaoCadastral, dataAbertura
- naturezaJuridica, porte, capitalSocial
- logradouro, numero, complemento, bairro, municipio, uf, cep
- telefoneCNPJ (formato: DDD + numero), emailCNPJ
- cnaePrincipal, descricaoCnaePrincipal
- socios (array com nome e qualificacao de cada socio)

Se algum campo nao existir, coloque null.

HTML (primeiros 15000 caracteres):
${html.substring(0, 15000)}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Extrair JSON da resposta
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`[Worker ${worker.id}]   Nao foi possivel extrair JSON da resposta`);
        await page.close();
        return null;
      }

      const dados = JSON.parse(jsonMatch[0]) as EmpresaCasaDados;
      dados.urlEmpresa = url;

      console.log(`[Worker ${worker.id}]   Dados extraidos: ${dados.razaoSocial || dados.nomeFantasia || 'N/A'}`);

      await page.close();
      return dados;

    } catch (error: any) {
      console.error(`[Worker ${worker.id}]   Erro ao extrair dados: ${error.message}`);
      await page.close();
      return null;
    }
  }

  // Versao do buscarGoogleMeuNegocio que usa um worker especifico
  private async buscarGoogleMeuNegocioWorker(termoBusca: string, worker: Worker): Promise<Partial<EmpresaCasaDados>> {
    if (!this.browser) return {};

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
      await page.type('textarea[name="q"]', termoBusca);
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      await new Promise(resolve => setTimeout(resolve, 2000));

      const html = await page.content();

      // Usar Gemini do worker
      const model = worker.gemini.getGenerativeModel({ model: this.config.geminiModel });

      const prompt = `Analise este HTML de resultados de busca do Google.
Verifique se existe um card do Google Meu Negocio (Google Business Profile) para este estabelecimento.
O card geralmente aparece do lado direito e contem telefone e horario de funcionamento.

Retorne APENAS um JSON valido (sem markdown):
{
  "encontrouCard": true/false,
  "telefone": "telefone encontrado ou null",
  "horario": "horario de funcionamento resumido ou null"
}

HTML (primeiros 20000 caracteres):
${html.substring(0, 20000)}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        await page.close();
        return {};
      }

      const dados = JSON.parse(jsonMatch[0]);
      const linkGMB = `https://www.google.com/search?q=${encodeURIComponent(termoBusca)}`;

      if (!dados.encontrouCard) {
        console.log(`[Worker ${worker.id}]     GMB nao encontrado (link incluido)`);
        await page.close();
        return { linkGMB };
      }

      console.log(`[Worker ${worker.id}]     GMB encontrado!`);
      await page.close();

      return {
        linkGMB,
        telefoneGMB: dados.telefone !== 'null' ? dados.telefone : undefined,
        horarioFuncionamento: dados.horario !== 'null' ? dados.horario : undefined
      };

    } catch (error: any) {
      console.error(`[Worker ${worker.id}]     Erro ao buscar GMB: ${error.message}`);
      await page.close();
      const linkGMBFallback = `https://www.google.com/search?q=${encodeURIComponent(termoBusca)}`;
      return { linkGMB: linkGMBFallback };
    }
  }

  // Versao do buscarInstagram que usa um worker especifico
  private async buscarInstagramWorker(termoBusca: string, cidadeEmpresa: string | undefined, worker: Worker): Promise<Partial<EmpresaCasaDados>> {
    if (!this.browser) return {};

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Buscar no Google
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(termoBusca)}`, { waitUntil: 'networkidle2' });
      await new Promise(resolve => setTimeout(resolve, 2000));

      const html = await page.content();

      // Usar Gemini do worker
      const model = worker.gemini.getGenerativeModel({ model: this.config.geminiModel });

      const prompt = `Analise este HTML de resultados de busca do Google procurando por perfil do Instagram.
Procure por links que contenham "instagram.com" nos resultados.

${cidadeEmpresa ? `A empresa esta localizada em: ${cidadeEmpresa}. Priorize perfis que mencionem essa cidade.` : ''}

Retorne APENAS um JSON valido (sem markdown):
{
  "encontrouInstagram": true/false,
  "instagramUrl": "url completa do instagram ou null",
  "instagramUsername": "username sem @ ou null"
}

HTML (primeiros 15000 caracteres):
${html.substring(0, 15000)}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        await page.close();
        return {};
      }

      const dados = JSON.parse(jsonMatch[0]);

      if (!dados.encontrouInstagram || !dados.instagramUrl) {
        console.log(`[Worker ${worker.id}]     Instagram nao encontrado`);
        await page.close();
        return {};
      }

      console.log(`[Worker ${worker.id}]     Instagram encontrado: @${dados.instagramUsername}`);

      // Tentar acessar o Instagram para extrair mais dados
      const dadosExtras = await this.extrairDadosInstagramWorker(page, dados.instagramUrl, worker);

      await page.close();

      return {
        instagramUrl: dados.instagramUrl,
        instagramUsername: dados.instagramUsername,
        ...dadosExtras
      };

    } catch (error: any) {
      console.error(`[Worker ${worker.id}]     Erro ao buscar Instagram: ${error.message}`);
      await page.close();
      return {};
    }
  }

  // Extrair dados adicionais do Instagram (bio, whatsapp, linktree)
  private async extrairDadosInstagramWorker(page: Page, instagramUrl: string, worker: Worker): Promise<Partial<EmpresaCasaDados>> {
    try {
      await page.goto(instagramUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(resolve => setTimeout(resolve, 2000));

      const html = await page.content();

      const model = worker.gemini.getGenerativeModel({ model: this.config.geminiModel });

      const prompt = `Analise este HTML de um perfil do Instagram e extraia:
- Bio do perfil
- Link do WhatsApp (wa.me ou api.whatsapp.com)
- Numero de WhatsApp (extraia o numero do link)
- Link do Linktree (linktr.ee)
- Site proprio (qualquer outro link que nao seja whatsapp ou linktree)

Retorne APENAS um JSON valido (sem markdown):
{
  "bio": "bio do perfil ou null",
  "whatsappLink": "link completo do whatsapp ou null",
  "whatsappNumero": "numero extraido ou null",
  "linktreeLink": "link do linktree ou null",
  "siteProprio": "site proprio ou null"
}

HTML (primeiros 10000 caracteres):
${html.substring(0, 10000)}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return {};

      const dados = JSON.parse(jsonMatch[0]);

      const resultado: Partial<EmpresaCasaDados> = {};

      if (dados.bio) resultado.instagramBio = dados.bio;
      if (dados.whatsappLink) resultado.whatsappBio = dados.whatsappLink;
      if (dados.whatsappNumero) resultado.numeroWhatsappBio = dados.whatsappNumero;
      if (dados.linktreeLink) resultado.linkTree = dados.linktreeLink;
      if (dados.siteProprio) resultado.siteProprio = dados.siteProprio;

      // Se tem linktree, tentar extrair dados dele
      if (dados.linktreeLink) {
        const dadosLinktree = await this.extrairDadosLinktreeWorker(dados.linktreeLink, worker);
        Object.assign(resultado, dadosLinktree);
      }

      return resultado;

    } catch (error: any) {
      console.error(`[Worker ${worker.id}]     Erro ao extrair dados do Instagram: ${error.message}`);
      return {};
    }
  }

  // Extrair dados do Linktree
  private async extrairDadosLinktreeWorker(linktreeUrl: string, worker: Worker): Promise<Partial<EmpresaCasaDados>> {
    if (!this.browser) return {};

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await page.goto(linktreeUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(resolve => setTimeout(resolve, 2000));

      const html = await page.content();

      const model = worker.gemini.getGenerativeModel({ model: this.config.geminiModel });

      const prompt = `Analise este HTML de um Linktree e extraia:
- Link do WhatsApp
- Numero de WhatsApp
- Site proprio (que nao seja whatsapp, instagram, facebook, etc)

Retorne APENAS um JSON valido:
{
  "whatsappLink": "link do whatsapp ou null",
  "whatsappNumero": "numero ou null",
  "siteProprio": "site proprio ou null"
}

HTML (primeiros 8000 caracteres):
${html.substring(0, 8000)}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        await page.close();
        return {};
      }

      const dados = JSON.parse(jsonMatch[0]);
      await page.close();

      const resultado: Partial<EmpresaCasaDados> = {};

      if (dados.whatsappLink) resultado.whatsappLinkTree = dados.whatsappLink;
      if (dados.whatsappNumero) resultado.numeroWhatsappLinkTree = dados.whatsappNumero;
      if (dados.siteProprio) resultado.siteProprioLinktree = dados.siteProprio;

      return resultado;

    } catch (error: any) {
      console.error(`[Worker ${worker.id}]     Erro ao extrair Linktree: ${error.message}`);
      await page.close();
      return {};
    }
  }

  // ========================================
  // METODOS ORIGINAIS (mantidos para compatibilidade)
  // ========================================

  private async extrairDadosEmpresa(url: string): Promise<EmpresaCasaDados | null> {
    if (!this.browser) return null;

    console.log(`  Acessando: ${url}`);

    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    if (this.config.casaDadosAuth) {
      await this.config.casaDadosAuth.aplicarCookies(page);
    }

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Extrair todo o texto da pagina
      const textoCompleto = await page.evaluate(() => {
        const elementos = Array.from(document.querySelectorAll('script, style, noscript'));
        elementos.forEach(el => el.remove());
        return document.body.innerText;
      });

      // Usar IA para extrair os dados estruturados
      const dados = await this.extrairDadosComIA(textoCompleto, url);

      await page.close();
      return dados;

    } catch (error: any) {
      console.error(`  Erro ao acessar empresa: ${error.message}`);
      await page.close();
      return null;
    }
  }

  private async extrairDadosComIA(textoCompleto: string, url: string): Promise<EmpresaCasaDados> {
    console.log('  Usando IA para extrair dados do CNPJ...');

    const prompt = `Analise o texto de uma pagina do Casa dos Dados e extraia TODAS as informacoes.

Texto:
"""
${textoCompleto.substring(0, 12000)}
"""

Extraia EXATAMENTE neste formato JSON:
{
  "razaoSocial": "valor ou null",
  "nomeFantasia": "valor ou null",
  "cnpj": "valor formatado XX.XXX.XXX/XXXX-XX ou null",
  "situacaoCadastral": "valor ou null",
  "dataAbertura": "valor ou null",
  "dataSituacao": "valor ou null",
  "motivoSituacao": "valor ou null",
  "naturezaJuridica": "valor ou null",
  "porte": "valor ou null",
  "capitalSocial": "valor ou null",
  "empresaMEI": true/false ou null,
  "simples": true/false ou null,
  "logradouro": "valor ou null",
  "numero": "valor ou null",
  "complemento": "valor ou null",
  "bairro": "valor ou null",
  "municipio": "valor ou null",
  "uf": "sigla de 2 letras ou null",
  "cep": "valor ou null",
  "telefoneCNPJ": "valor ou null",
  "emailCNPJ": "valor ou null",
  "cnaePrincipal": "codigo - descricao ou null",
  "descricaoCnaePrincipal": "descricao ou null",
  "cnaesSecundarios": ["lista"] ou [],
  "socios": [{"nome": "Nome", "qualificacao": "Tipo", "dataEntrada": "data"}] ou []
}

IMPORTANTE: Extraia os dados EXATAMENTE como aparecem. Se nao encontrar, use null.`;

    try {
      const resposta = await this.chamarIAComRetry(prompt);

      const jsonMatch = resposta.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('  IA nao retornou JSON valido');
        return { urlEmpresa: url };
      }

      const dados = JSON.parse(jsonMatch[0]);

      const limparValor = (val: any) => {
        if (val === 'null' || val === null || val === '') return undefined;
        return val;
      };

      const resultado: EmpresaCasaDados = {
        razaoSocial: limparValor(dados.razaoSocial),
        nomeFantasia: limparValor(dados.nomeFantasia),
        cnpj: limparValor(dados.cnpj),
        situacaoCadastral: limparValor(dados.situacaoCadastral),
        dataAbertura: limparValor(dados.dataAbertura),
        dataSituacao: limparValor(dados.dataSituacao),
        motivoSituacao: limparValor(dados.motivoSituacao),
        naturezaJuridica: limparValor(dados.naturezaJuridica),
        porte: limparValor(dados.porte),
        capitalSocial: limparValor(dados.capitalSocial),
        empresaMEI: dados.empresaMEI === true || dados.empresaMEI === 'Sim',
        simples: dados.simples === true || dados.simples === 'Sim',
        logradouro: limparValor(dados.logradouro),
        numero: limparValor(dados.numero),
        complemento: limparValor(dados.complemento),
        bairro: limparValor(dados.bairro),
        municipio: limparValor(dados.municipio),
        uf: limparValor(dados.uf),
        cep: limparValor(dados.cep),
        telefoneCNPJ: limparValor(dados.telefoneCNPJ),
        emailCNPJ: limparValor(dados.emailCNPJ),
        cnaePrincipal: limparValor(dados.cnaePrincipal),
        descricaoCnaePrincipal: limparValor(dados.descricaoCnaePrincipal),
        cnaesSecundarios: dados.cnaesSecundarios?.length > 0 ? dados.cnaesSecundarios : undefined,
        socios: dados.socios?.length > 0 ? dados.socios : undefined,
        urlEmpresa: url
      };

      console.log(`  Dados extraidos: ${resultado.razaoSocial || 'N/A'}`);
      if (resultado.nomeFantasia) console.log(`    Nome Fantasia: ${resultado.nomeFantasia}`);
      if (resultado.cnpj) console.log(`    CNPJ: ${resultado.cnpj}`);
      if (resultado.municipio) console.log(`    Cidade: ${resultado.municipio}/${resultado.uf}`);
      if (resultado.telefoneCNPJ) console.log(`    Telefone: ${resultado.telefoneCNPJ}`);

      return resultado;

    } catch (error: any) {
      console.error(`  Erro ao extrair dados com IA: ${error.message}`);
      return { urlEmpresa: url };
    }
  }

  private async buscarGoogleMeuNegocio(termoBusca: string): Promise<Partial<EmpresaCasaDados>> {
    if (!this.browser) return {};

    console.log('  Buscando Google Meu Negocio...');

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
      await page.type('textarea[name="q"]', termoBusca);
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      await page.waitForTimeout(2000);

      const textoCompleto = await page.evaluate(() => document.body.innerText);

      const prompt = `Analise o texto de resultados do Google e identifique o card do Google Meu Negocio.

Texto:
"""
${textoCompleto.substring(0, 10000)}
"""

Extraia do card GMB (se existir):
{
  "encontrouCard": true/false,
  "telefone": "numero ou null",
  "horario": "horario completo ou null"
}

Se nao encontrar o card, use encontrouCard: false.`;

      const resposta = await this.chamarIAComRetry(prompt);
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        await page.close();
        return {};
      }

      const dados = JSON.parse(jsonMatch[0]);

      // Sempre gerar o link de busca do Google (para que o usuario possa acessar manualmente)
      const linkGMB = `https://www.google.com/search?q=${encodeURIComponent(termoBusca)}`;

      if (!dados.encontrouCard) {
        console.log('    GMB card nao encontrado (link de busca incluido)');
        await page.close();
        // Retorna pelo menos o link de busca para o usuario poder verificar manualmente
        return { linkGMB };
      }

      console.log('    GMB encontrado!');
      if (dados.telefone) console.log(`      Telefone: ${dados.telefone}`);
      if (dados.horario) console.log(`      Horario: ${dados.horario}`);

      await page.close();

      return {
        linkGMB,
        telefoneGMB: dados.telefone !== 'null' ? dados.telefone : undefined,
        horarioFuncionamento: dados.horario !== 'null' ? dados.horario : undefined
      };

    } catch (error: any) {
      console.error('    Erro ao buscar GMB:', error.message);
      await page.close();
      // Mesmo com erro, retorna o link de busca para o usuario poder verificar manualmente
      const linkGMBFallback = `https://www.google.com/search?q=${encodeURIComponent(termoBusca)}`;
      return { linkGMB: linkGMBFallback };
    }
  }

  private async buscarInstagram(termoBusca: string, cidadeEmpresa?: string): Promise<Partial<EmpresaCasaDados>> {
    if (!this.browser) return {};

    console.log('  Buscando Instagram...');

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
      await page.type('textarea[name="q"]', termoBusca);
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });

      // Procurar link do Instagram nos resultados
      const instagramUrl = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
          if (link.href.includes('instagram.com/') && !link.href.includes('/p/') && !link.href.includes('/reel/')) {
            return link.href;
          }
        }
        return null;
      });

      if (!instagramUrl) {
        console.log('    Instagram nao encontrado');
        await page.close();
        return {};
      }

      console.log(`    Instagram encontrado: ${instagramUrl}`);

      // Acessar perfil do Instagram
      if (this.config.instagramAuth) {
        await this.config.instagramAuth.aplicarCookies(page);
      }

      await page.goto(instagramUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Verificar se redirecionou para login
      const estaNoLogin = await page.evaluate(() => {
        return window.location.pathname.includes('/accounts/login');
      });

      if (estaNoLogin) {
        console.log('    Instagram redirecionou para login, pulando...');
        await page.close();
        return { instagramUrl };
      }

      // Extrair dados do perfil - bio E links externos
      const dadosPerfil = await page.evaluate(() => {
        const username = window.location.pathname.split('/').filter(Boolean)[0] || '';

        // Tentar extrair bio de varias formas
        let bio = '';

        // Metodo 1: Seletores conhecidos
        const bioSelectors = [
          'header section div._aa_c span',
          'header div._aa_c span',
          'div.-vDIg span',
          'h1 + div',
          'section main header section div span'
        ];

        for (const selector of bioSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent && el.textContent.length > 10) {
            bio = el.textContent;
            break;
          }
        }

        // Metodo 2: Pegar todo texto da header se bio ainda vazia
        if (!bio) {
          const header = document.querySelector('header');
          if (header) {
            bio = header.innerText || '';
          }
        }

        // Extrair links externos da pagina (link na bio)
        const linksExternos: string[] = [];
        const todosLinks = document.querySelectorAll('a[href]');
        todosLinks.forEach(link => {
          const href = (link as HTMLAnchorElement).href;
          // Lista de dominios a ignorar (redes sociais do proprio Meta/Instagram)
          const dominiosIgnorar = [
            'instagram.com', 'facebook.com', 'threads.com', 'threads.net',
            'meta.com', 'fb.com', 'fb.me'
          ];
          const deveIgnorar = dominiosIgnorar.some(d => href.includes(d));

          // Pegar links que nao sao redes sociais do Meta
          if (href && !deveIgnorar &&
              (href.includes('linktr.ee') || href.includes('wa.me') || href.includes('whatsapp') ||
               href.includes('bio.link') || href.includes('beacons.ai') || href.includes('linkin.bio') ||
               href.includes('.com.br') || href.includes('.com/') || href.includes('bit.ly'))) {
            linksExternos.push(href);
          }
        });

        return { username, bio, linksExternos };
      });

      console.log(`    Username: @${dadosPerfil.username}`);
      if (dadosPerfil.bio) {
        console.log(`    Bio: ${dadosPerfil.bio.substring(0, 100)}...`);
      }
      if (dadosPerfil.linksExternos.length > 0) {
        console.log(`    Links externos encontrados: ${dadosPerfil.linksExternos.length}`);
        dadosPerfil.linksExternos.forEach(l => console.log(`      - ${l}`));
      }

      // Verificar se a cidade do Instagram bate com a cidade da empresa
      if (cidadeEmpresa) {
        const cidadeCorreta = await this.verificarCidadeInstagram(dadosPerfil.bio, cidadeEmpresa);
        if (!cidadeCorreta) {
          console.log(`    CIDADE NAO CONFERE - Descartando Instagram`);
          await page.close();
          return {};
        }
      }

      // Extrair WhatsApp direto dos links encontrados
      let whatsappBio: string | undefined;
      let numeroWhatsappBio: string | undefined;

      for (const link of dadosPerfil.linksExternos) {
        if (link.includes('wa.me') || link.includes('whatsapp')) {
          whatsappBio = link;
          // Extrair numero do link
          const match = link.match(/wa\.me\/(\d+)/);
          if (match) {
            numeroWhatsappBio = match[1];
          }
          console.log(`    WhatsApp encontrado na bio: ${whatsappBio}`);
          break;
        }
      }

      // Se nao encontrou nos links, tentar extrair do texto da bio
      if (!whatsappBio) {
        const whatsappDaBio = this.extrairWhatsAppDaBio(dadosPerfil.bio);
        whatsappBio = whatsappDaBio.link || undefined;
        numeroWhatsappBio = whatsappDaBio.numero || undefined;
        if (whatsappBio) {
          console.log(`    WhatsApp extraido do texto: ${whatsappBio}`);
        }
      }

      // Extrair Linktree dos links encontrados
      let linkTree: string | undefined;
      let siteProprio: string | undefined;

      for (const link of dadosPerfil.linksExternos) {
        // Linktree e similares
        if (link.includes('linktr.ee') || link.includes('bio.link') || link.includes('beacons.ai') ||
            link.includes('linkin.bio') || link.includes('linkr.bio') || link.includes('tap.bio') ||
            link.includes('campsite.bio') || link.includes('hoo.be') || link.includes('solo.to') ||
            link.includes('carrd.co') || link.includes('lnk.bio') || link.includes('allmylinks')) {
          linkTree = link;
          console.log(`    Linktree encontrado: ${linkTree}`);
        }
        // Site proprio (nao e rede social nem linktree)
        else if (!link.includes('wa.me') && !link.includes('whatsapp') && !link.includes('bit.ly') &&
                 (link.includes('.com.br') || link.includes('.com/'))) {
          siteProprio = link;
          console.log(`    Site proprio encontrado: ${siteProprio}`);
        }
      }

      // Se nao encontrou nos links, usar IA para extrair da bio
      if (!linkTree && !siteProprio) {
        const linksDaBio = await this.extrairLinksDaBio(dadosPerfil.bio);
        linkTree = linksDaBio.linkTree || undefined;
        siteProprio = linksDaBio.siteProprio || undefined;
      }

      let resultadoInsta: Partial<EmpresaCasaDados> = {
        instagramUrl,
        instagramUsername: dadosPerfil.username,
        instagramBio: dadosPerfil.bio || undefined,
        whatsappBio,
        numeroWhatsappBio,
        linkTree,
        siteProprio
      };

      // Se tem Linktree, processar para buscar mais dados
      if (linkTree) {
        console.log(`    Processando Linktree: ${linkTree}`);
        const dadosLinktree = await this.processarLinktree(linkTree);
        resultadoInsta = {
          ...resultadoInsta,
          whatsappLinkTree: dadosLinktree.whatsappLink || undefined,
          numeroWhatsappLinkTree: dadosLinktree.numeroWhatsapp || undefined,
          siteProprioLinktree: dadosLinktree.siteProprio || undefined
        };
      }

      await page.close();
      return resultadoInsta;

    } catch (error: any) {
      console.error('    Erro ao buscar Instagram:', error.message);
      await page.close();
      return {};
    }
  }

  private async verificarCidadeInstagram(bioInstagram: string, cidadeEmpresa: string): Promise<boolean> {
    if (!bioInstagram || !cidadeEmpresa) {
      // Se nao tem bio, considera como correto
      console.log('    Sem bio para verificar cidade - considerando correto');
      return true;
    }

    try {
      const prompt = `Analise a bio do Instagram e verifique se menciona a cidade "${cidadeEmpresa}" ou uma cidade DIFERENTE.

Bio do Instagram:
"${bioInstagram}"

Cidade da empresa: ${cidadeEmpresa}

INSTRUCOES:
1. Se a bio menciona "${cidadeEmpresa}" ou variacao (ex: SP para Sao Paulo), responda "MESMA_CIDADE"
2. Se a bio menciona OUTRA cidade diferente, responda "CIDADE_DIFERENTE"
3. Se a bio NAO menciona nenhuma cidade/endereco, responda "SEM_CIDADE"

Responda APENAS com: MESMA_CIDADE, CIDADE_DIFERENTE ou SEM_CIDADE`;

      const resposta = await this.chamarIAComRetry(prompt);
      const respostaLimpa = resposta.toUpperCase().trim();

      console.log(`    Verificacao de cidade: ${respostaLimpa}`);

      if (respostaLimpa.includes('CIDADE_DIFERENTE')) {
        return false;
      }

      // MESMA_CIDADE ou SEM_CIDADE = considera correto
      return true;

    } catch (error: any) {
      console.error('    Erro ao verificar cidade:', error.message);
      // Em caso de erro, considera como correto
      return true;
    }
  }

  private extrairWhatsAppDaBio(bio: string): { link: string | null, numero: string | null } {
    if (!bio) return { link: null, numero: null };

    const padroes = [
      /(?:https?:\/\/)?(?:www\.)?wa\.me\/(\d+)/gi,
      /(?:https?:\/\/)?(?:www\.)?api\.whatsapp\.com\/send\?phone=(\d+)/gi,
      /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/send\?phone=(\d+)/gi,
    ];

    for (const padrao of padroes) {
      const match = padrao.exec(bio);
      if (match && match[1]) {
        const numero = this.formatarNumeroWhatsApp(match[1]);
        if (numero) {
          return { link: `https://wa.me/${numero}`, numero };
        }
      }
      padrao.lastIndex = 0;
    }

    // Tentar encontrar numero no texto
    const padraoTexto = /(?:whatsapp|whats|wpp|zap)[\s:]*[\(]?(\d{2})[\)]?[\s.-]?(\d{4,5})[\s.-]?(\d{4})/gi;
    const matchTexto = padraoTexto.exec(bio);

    if (matchTexto) {
      const apenasNumeros = matchTexto[0].replace(/\D/g, '');
      if (apenasNumeros.length >= 10) {
        const numero = this.formatarNumeroWhatsApp(apenasNumeros);
        if (numero) {
          return { link: `https://wa.me/${numero}`, numero };
        }
      }
    }

    return { link: null, numero: null };
  }

  private formatarNumeroWhatsApp(numero: string): string | null {
    if (!numero) return null;

    let apenasNumeros = numero.replace(/\D/g, '');

    if (apenasNumeros.startsWith('0')) {
      apenasNumeros = apenasNumeros.substring(1);
    }

    const len = apenasNumeros.length;

    if (len < 10) return null;

    if (apenasNumeros.startsWith('55')) {
      if (len === 12) {
        const ddd = apenasNumeros.substring(2, 4);
        const telefone = apenasNumeros.substring(4);
        if (parseInt(telefone.charAt(0)) >= 6) {
          apenasNumeros = '55' + ddd + '9' + telefone;
        }
      }
      return apenasNumeros;
    }

    if (len === 10) {
      const ddd = apenasNumeros.substring(0, 2);
      const telefone = apenasNumeros.substring(2);
      if (parseInt(telefone.charAt(0)) >= 6) {
        apenasNumeros = '55' + ddd + '9' + telefone;
      } else {
        apenasNumeros = '55' + apenasNumeros;
      }
    } else if (len === 11) {
      apenasNumeros = '55' + apenasNumeros;
    } else {
      apenasNumeros = '55' + apenasNumeros;
    }

    return apenasNumeros;
  }

  private async extrairLinksDaBio(bio: string): Promise<{ linkTree: string | null, siteProprio: string | null }> {
    if (!bio) return { linkTree: null, siteProprio: null };

    try {
      const prompt = `Analise a bio do Instagram e identifique links:

Bio: "${bio}"

Procure por:
1. Servicos de "link in bio": linktr.ee, beacons.ai, bio.link, linkin.bio, etc
2. Sites proprios (dominios que NAO sao redes sociais)

Responda JSON:
{
  "linktree": "URL_COMPLETA ou null",
  "site": "URL_COMPLETA ou null"
}`;

      const resposta = await this.chamarIAComRetry(prompt);
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const dados = JSON.parse(jsonMatch[0]);
        return {
          linkTree: dados.linktree !== 'null' ? this.normalizarUrl(dados.linktree) : null,
          siteProprio: dados.site !== 'null' ? this.normalizarUrl(dados.site) : null
        };
      }
    } catch (error) {
      // Ignorar erros
    }

    return { linkTree: null, siteProprio: null };
  }

  private async processarLinktree(linktreeUrl: string): Promise<{ whatsappLink: string | null, numeroWhatsapp: string | null, siteProprio: string | null }> {
    if (!this.browser) return { whatsappLink: null, numeroWhatsapp: null, siteProprio: null };

    const urlNormalizada = this.normalizarUrl(linktreeUrl);
    if (!urlNormalizada) return { whatsappLink: null, numeroWhatsapp: null, siteProprio: null };

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.goto(urlNormalizada, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(2000);

      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map(el => ({
          href: (el as HTMLAnchorElement).href,
          text: el.textContent?.trim() || ''
        }));
      });

      const linksTexto = links.map((l, i) => `${i + 1}. "${l.text}" -> ${l.href}`).join('\n');

      const prompt = `Analise links do Linktree:

${linksTexto}

Identifique:
1. Link WhatsApp (wa.me, whatsapp.com, etc)
2. Site proprio (NAO redes sociais)

JSON:
{
  "whatsapp": {"link": "URL ou null", "numero": "NUMERO ou null"},
  "siteProprio": {"link": "URL ou null"}
}`;

      const resposta = await this.chamarIAComRetry(prompt);
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        await page.close();
        return { whatsappLink: null, numeroWhatsapp: null, siteProprio: null };
      }

      const dados = JSON.parse(jsonMatch[0]);

      await page.close();

      return {
        whatsappLink: dados.whatsapp?.link !== 'null' ? this.normalizarUrl(dados.whatsapp?.link) : null,
        numeroWhatsapp: dados.whatsapp?.numero || null,
        siteProprio: dados.siteProprio?.link !== 'null' ? this.normalizarUrl(dados.siteProprio?.link) : null
      };

    } catch (error: any) {
      await page.close();
      return { whatsappLink: null, numeroWhatsapp: null, siteProprio: null };
    }
  }

  private normalizarUrl(url: string | null): string | null {
    if (!url) return null;
    const urlTrimmed = url.trim();
    if (!urlTrimmed) return null;

    if (urlTrimmed.startsWith('http://') || urlTrimmed.startsWith('https://')) {
      return urlTrimmed;
    }

    return 'https://' + urlTrimmed;
  }

  private async verificarResultados(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const indicadores = [
          'a[href*="/empresa/"]',
          'a[href*="cnpj"]',
          'table tbody tr',
          '.result-item',
          '[class*="resultado"]',
          '[class*="empresa"]'
        ];

        for (const seletor of indicadores) {
          const elementos = document.querySelectorAll(seletor);
          if (elementos.length > 0) {
            const texto = elementos[0].textContent || '';
            if (texto.length > 10) return true;
          }
        }

        return false;
      });
    } catch {
      return false;
    }
  }

  private async clicarBotaoPesquisa(page: Page): Promise<boolean> {
    try {
      console.log('  Analisando estrutura da pagina...');

      const screenshotPath = path.join(__dirname, '../.debug-casadosdados.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`  Screenshot salvo em: ${screenshotPath}`);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);

      // Estrategia 1: Buscar por texto
      const clicouPorTexto = await page.evaluate(() => {
        const textosAlvo = ['pesquisar', 'buscar', 'filtrar', 'search', 'aplicar', 'consultar'];
        const elementos = document.querySelectorAll('button, input[type="submit"], a[role="button"], [class*="btn"]');

        for (const el of Array.from(elementos)) {
          const texto = (el.textContent || '').toLowerCase().trim();
          const value = (el as HTMLInputElement).value?.toLowerCase() || '';
          const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';

          for (const alvo of textosAlvo) {
            if (texto.includes(alvo) || value.includes(alvo) || ariaLabel.includes(alvo)) {
              (el as HTMLElement).click();
              return true;
            }
          }
        }
        return false;
      });

      if (clicouPorTexto) {
        console.log('  Clicado usando busca por texto');
        return true;
      }

      // Estrategia 2: Seletores CSS
      const seletores = ['button[type="submit"]', 'button.btn-primary', 'form button', 'input[type="submit"]'];
      for (const seletor of seletores) {
        const el = await page.$(seletor);
        if (el) {
          await el.click();
          console.log(`  Clicado: ${seletor}`);
          return true;
        }
      }

      // Estrategia 3: Enter no input
      await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="search"]');
        if (inputs.length > 0) (inputs[inputs.length - 1] as HTMLInputElement).focus();
      });
      await page.keyboard.press('Enter');
      console.log('  Pressionou Enter');

      return true;

    } catch (error: any) {
      console.log(`  Erro ao clicar botao: ${error.message}`);
      return false;
    }
  }

  private async irParaProximaPagina(page: Page): Promise<boolean> {
    console.log('');
    console.log('========================================');
    console.log('Verificando proxima pagina...');

    try {
      // Scroll ate o final para garantir que paginacao esta visivel
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      // Seletores comuns para paginacao
      const seletores = [
        'a[rel="next"]',
        '.pagination li:last-child a',
        '[class*="next"]',
        'button[aria-label*="proximo"]',
        'button[aria-label*="próximo"]',
        '.pagination .next a',
        'nav[aria-label*="pagination"] a:last-child',
        '[class*="pagination"] button:last-child',
        '[class*="pager"] a:last-child'
      ];

      for (const seletor of seletores) {
        const existe = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const disabled = el.hasAttribute('disabled') ||
            el.classList.contains('disabled') ||
            el.getAttribute('aria-disabled') === 'true';
          return !disabled;
        }, seletor);

        if (existe) {
          console.log(`  Encontrou botao via seletor: ${seletor}`);
          await page.click(seletor);
          await page.waitForTimeout(3000);
          console.log('  ✓ Navegou para proxima pagina');
          return true;
        }
      }

      // Tentar por texto ou simbolo
      const clicouProximo = await page.evaluate(() => {
        const elementos = document.querySelectorAll('button, a, span[role="button"], div[role="button"]');
        for (const el of Array.from(elementos)) {
          const texto = (el.textContent || '').trim().toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

          // Verificar se e o botao de proxima pagina
          const eProximaPagina =
            texto === '>' ||
            texto === '>>' ||
            texto === '→' ||
            texto === 'next' ||
            texto.includes('proxim') ||
            texto.includes('próxim') ||
            ariaLabel.includes('next') ||
            ariaLabel.includes('proxim') ||
            ariaLabel.includes('próxim');

          if (eProximaPagina) {
            const disabled = el.hasAttribute('disabled') ||
              el.classList.contains('disabled') ||
              el.getAttribute('aria-disabled') === 'true';

            if (!disabled) {
              console.log('Encontrou botao:', texto || ariaLabel);
              (el as HTMLElement).click();
              return true;
            }
          }
        }

        // Tentar encontrar numeros de pagina e clicar no proximo
        const paginaAtualEl = document.querySelector('.pagination .active, [class*="page"][class*="current"], [aria-current="page"]');
        if (paginaAtualEl) {
          const numeroAtual = parseInt(paginaAtualEl.textContent || '1');
          const proximoNumero = numeroAtual + 1;

          // Procurar link com o proximo numero
          const todosLinks = document.querySelectorAll('.pagination a, [class*="page"] a');
          for (const link of Array.from(todosLinks)) {
            if (link.textContent?.trim() === String(proximoNumero)) {
              (link as HTMLElement).click();
              return true;
            }
          }
        }

        return false;
      });

      if (clicouProximo) {
        console.log('  ✓ Clicou em proxima pagina via texto/numero');
        await page.waitForTimeout(3000);
        return true;
      }

      // Ultima tentativa: usar tecla de seta ou Page Down
      console.log('  Nenhum botao de paginacao encontrado');
      console.log('========================================');
      return false;

    } catch (error: any) {
      console.log(`  Erro ao navegar: ${error.message}`);
      return false;
    }
  }
}
