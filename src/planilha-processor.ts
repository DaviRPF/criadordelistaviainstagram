import puppeteer, { Browser, Page } from 'puppeteer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as XLSX from 'xlsx';
import { InstagramAuth } from './instagram-auth';

interface EmpresaPlanilha {
  nomeFantasia?: string;
  telefone?: string;
  razaoSocial: string;
  cnpj: string;
  capitalSocial?: string;
  tipo?: string;
  porte?: string;
  atividadePrincipal?: string;
  situacao?: string;
  dataAbertura?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  municipio?: string;
  bairro?: string;
  uf?: string;
  cep?: string;
  naturezaJuridica?: string;
  quadroSocietario?: string;
}

interface ResultadoEmpresa extends EmpresaPlanilha {
  nomeIdentificado: string;
  instagramUrl?: string;
  instagramUsername?: string;
  whatsappBio?: string;
  numeroWhatsappBio?: string;
  contatoBio?: string;
  contatoBioTemWhatsApp?: boolean;
  siteProprioBio?: string;
  linkTreeBio?: string;
  linkGMB?: string;
  telefoneGMB?: string;
  telefoneGMBTemWhatsApp?: boolean;
  horarioFuncionamento?: string;
}

interface ProcessorConfig {
  geminiApiKey: string;
  geminiModel: string;
  instagramAuth: InstagramAuth;
  onProgresso?: (resultado: ResultadoEmpresa, atual: number, total: number) => void;
}

export class PlanilhaProcessor {
  private config: ProcessorConfig;
  private browser: Browser | null = null;
  private gemini: GoogleGenerativeAI;
  private resultados: ResultadoEmpresa[] = [];

  constructor(config: ProcessorConfig) {
    this.config = config;
    this.gemini = new GoogleGenerativeAI(config.geminiApiKey);
  }

  // Ler planilha xlsx/xls
  lerPlanilha(buffer: Buffer): EmpresaPlanilha[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const dados = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    // Primeira linha é o cabeçalho
    const headers = dados[0] as string[];
    const empresas: EmpresaPlanilha[] = [];

    // Mapear índices das colunas
    const getIndex = (nome: string) => headers.findIndex(h =>
      h && h.toString().toLowerCase().includes(nome.toLowerCase())
    );

    const idxNomeFantasia = getIndex('nome fantasia');
    const idxTelefone = getIndex('telefone');
    const idxRazaoSocial = getIndex('razão social') !== -1 ? getIndex('razão social') : getIndex('razao social');
    const idxCnpj = getIndex('cnpj');
    const idxCapitalSocial = getIndex('capital social');
    const idxTipo = getIndex('tipo');
    const idxPorte = getIndex('porte');
    const idxAtividade = getIndex('atividade principal');
    const idxSituacao = getIndex('situação') !== -1 ? getIndex('situação') : getIndex('situacao');
    const idxDataAbertura = getIndex('data de abertura');
    const idxLogradouro = getIndex('logradouro');
    const idxNumero = getIndex('numero');
    const idxComplemento = getIndex('complemento');
    const idxMunicipio = getIndex('municipio');
    const idxBairro = getIndex('bairro');
    const idxUf = getIndex('uf');
    const idxCep = getIndex('cep');
    const idxNatureza = getIndex('natureza');
    const idxQuadro = getIndex('quadro');

    // Processar linhas (pular cabeçalho)
    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      if (!row || row.length === 0) continue;

      const razaoSocial = row[idxRazaoSocial]?.toString() || '';
      const cnpj = row[idxCnpj]?.toString() || '';

      // Pular linhas sem razão social ou cnpj
      if (!razaoSocial && !cnpj) continue;

      empresas.push({
        nomeFantasia: row[idxNomeFantasia]?.toString() || undefined,
        telefone: row[idxTelefone]?.toString() || undefined,
        razaoSocial,
        cnpj,
        capitalSocial: row[idxCapitalSocial]?.toString() || undefined,
        tipo: row[idxTipo]?.toString() || undefined,
        porte: row[idxPorte]?.toString() || undefined,
        atividadePrincipal: row[idxAtividade]?.toString() || undefined,
        situacao: row[idxSituacao]?.toString() || undefined,
        dataAbertura: row[idxDataAbertura]?.toString() || undefined,
        logradouro: row[idxLogradouro]?.toString() || undefined,
        numero: row[idxNumero]?.toString() || undefined,
        complemento: row[idxComplemento]?.toString() || undefined,
        municipio: row[idxMunicipio]?.toString() || undefined,
        bairro: row[idxBairro]?.toString() || undefined,
        uf: row[idxUf]?.toString() || undefined,
        cep: row[idxCep]?.toString() || undefined,
        naturezaJuridica: row[idxNatureza]?.toString() || undefined,
        quadroSocietario: row[idxQuadro]?.toString() || undefined,
      });
    }

    console.log(`📊 Planilha carregada: ${empresas.length} empresas encontradas`);
    return empresas;
  }

  // Identificar nome comercial da empresa
  private async identificarNomeEmpresa(empresa: EmpresaPlanilha): Promise<string> {
    // Se tem nome fantasia, usar ele
    if (empresa.nomeFantasia && empresa.nomeFantasia.trim()) {
      console.log(`     ✅ Usando Nome Fantasia: ${empresa.nomeFantasia}`);
      return empresa.nomeFantasia.trim();
    }

    // Usar IA para extrair nome da razão social
    console.log('     🤖 Usando IA para extrair nome da Razão Social...');

    const prompt = `Extraia o nome comercial/fantasia desta Razão Social de empresa.

Razão Social: "${empresa.razaoSocial}"
Município: ${empresa.municipio || 'N/A'}
Atividade: ${empresa.atividadePrincipal || 'N/A'}

REGRAS:
1. Remova sufixos como LTDA, ME, EPP, EIRELI, S/A, etc.
2. Remova números de CPF/CNPJ que aparecem no início (ex: "63.430.257 MARIA EDUARDA")
3. Se for nome de pessoa (Empresário Individual), retorne o primeiro e último nome
4. Se for nome de empresa, retorne o nome comercial limpo
5. Não inclua cidade ou atividade no nome

Retorne APENAS o nome, nada mais.`;

    try {
      const resposta = await this.chamarIA(prompt);
      const nomeExtraido = resposta.trim();
      console.log(`     ✅ Nome extraído: ${nomeExtraido}`);
      return nomeExtraido;
    } catch (error: any) {
      console.log('     ⚠️  Erro ao extrair nome, usando Razão Social');
      // Fallback: limpar razão social básica
      return empresa.razaoSocial
        .replace(/\d{2}\.\d{3}\.\d{3}\s*/g, '') // Remove CNPJ no início
        .replace(/\s*(LTDA|ME|EPP|EIRELI|S\/A|SA)\.?$/gi, '')
        .trim();
    }
  }

  // Buscar Instagram da empresa no Google
  private async buscarInstagramNoGoogle(page: Page, nomeEmpresa: string, cidade?: string): Promise<string | null> {
    const query = `${nomeEmpresa} ${cidade || ''} instagram`.trim();
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    console.log(`     🔎 Buscando: "${query}"`);

    try {
      await page.goto(googleUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Extrair resultados
      const resultados = await page.evaluate(() => {
        const links: { titulo: string; url: string }[] = [];
        const elementos = document.querySelectorAll('div.g a[href]');

        elementos.forEach(el => {
          const href = (el as HTMLAnchorElement).href;
          const titulo = el.closest('div.g')?.querySelector('h3')?.textContent || '';
          if (href && !href.includes('google.com')) {
            links.push({ titulo, url: href });
          }
        });

        return links.slice(0, 10);
      });

      // Procurar resultado do Instagram
      for (const resultado of resultados) {
        if (resultado.url.includes('instagram.com') &&
            !resultado.url.includes('/explore') &&
            !resultado.url.includes('/accounts')) {
          console.log(`     ✅ Instagram encontrado: ${resultado.url}`);
          return resultado.url;
        }
      }

      console.log('     ❌ Instagram não encontrado');
      return null;

    } catch (error: any) {
      console.error('     ⚠️  Erro ao buscar no Google:', error.message);
      return null;
    }
  }

  // Processar perfil do Instagram
  private async processarInstagram(page: Page, url: string): Promise<{
    username: string;
    whatsappBio?: string;
    numeroWhatsappBio?: string;
    contatoBio?: string;
    siteProprioBio?: string;
    linkTreeBio?: string;
  } | null> {
    try {
      await this.config.instagramAuth.aplicarCookies(page);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Verificar se está no login
      const estaNoLogin = await page.evaluate(() => {
        return window.location.pathname.includes('/accounts/login');
      });

      if (estaNoLogin) {
        console.log('     ⚠️  Instagram redirecionou para login');
        return null;
      }

      // Extrair dados
      const dados = await page.evaluate(() => {
        const username = window.location.pathname.split('/').filter(Boolean)[0] || '';

        const bio =
          document.querySelector('header section div._aa_c span')?.textContent ||
          document.querySelector('header div._aa_c span')?.textContent ||
          '';

        return { username, bio };
      });

      console.log(`     📱 Username: @${dados.username}`);
      console.log(`     📝 Bio: ${dados.bio.substring(0, 80)}...`);

      // Extrair WhatsApp da bio
      const whatsappInfo = this.extrairWhatsAppDaBio(dados.bio);

      // Extrair contato e links da bio usando IA
      const linksInfo = await this.extrairLinksDaBio(dados.bio);

      return {
        username: dados.username,
        whatsappBio: whatsappInfo.link || undefined,
        numeroWhatsappBio: whatsappInfo.numero || undefined,
        contatoBio: linksInfo.contato || undefined,
        siteProprioBio: linksInfo.site || undefined,
        linkTreeBio: linksInfo.linktree || undefined,
      };

    } catch (error: any) {
      console.error('     ⚠️  Erro ao processar Instagram:', error.message);
      return null;
    }
  }

  // Extrair WhatsApp da bio (mesmo método do scraper original)
  private extrairWhatsAppDaBio(bio: string): { link: string | null, numero: string | null } {
    if (!bio) return { link: null, numero: null };

    const padroes = [
      /(?:https?:\/\/)?(?:www\.)?wa\.me\/(\d+)/gi,
      /(?:https?:\/\/)?(?:www\.)?api\.whatsapp\.com\/send\?phone=(\d+)/gi,
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

    // Procurar menção de WhatsApp no texto
    const padraoTexto = /(?:whatsapp|whats|wpp|zap)[\s:]*[\(]?(\d{2})[\)]?[\s.-]?(\d{4,5})[\s.-]?(\d{4})/gi;
    const matchTexto = padraoTexto.exec(bio);

    if (matchTexto) {
      const apenasNumeros = matchTexto[0].replace(/\D/g, '');
      const numero = this.formatarNumeroWhatsApp(apenasNumeros);
      if (numero) {
        return { link: `https://wa.me/${numero}`, numero };
      }
    }

    return { link: null, numero: null };
  }

  // Formatar número para WhatsApp
  private formatarNumeroWhatsApp(numero: string): string | null {
    let apenasNumeros = numero.replace(/\D/g, '');

    if (apenasNumeros.startsWith('0')) {
      apenasNumeros = apenasNumeros.substring(1);
    }

    if (apenasNumeros.length < 10) return null;

    if (apenasNumeros.startsWith('55')) {
      if (apenasNumeros.length === 12) {
        const ddd = apenasNumeros.substring(2, 4);
        const telefone = apenasNumeros.substring(4);
        if (parseInt(telefone.charAt(0)) >= 6) {
          apenasNumeros = '55' + ddd + '9' + telefone;
        }
      }
      return apenasNumeros;
    }

    if (apenasNumeros.length === 10) {
      const ddd = apenasNumeros.substring(0, 2);
      const telefone = apenasNumeros.substring(2);
      if (parseInt(telefone.charAt(0)) >= 6) {
        apenasNumeros = '55' + ddd + '9' + telefone;
      } else {
        apenasNumeros = '55' + apenasNumeros;
      }
    } else if (apenasNumeros.length === 11) {
      apenasNumeros = '55' + apenasNumeros;
    }

    return apenasNumeros;
  }

  // Extrair links da bio usando IA
  private async extrairLinksDaBio(bio: string): Promise<{ contato?: string; site?: string; linktree?: string }> {
    if (!bio) return {};

    try {
      const prompt = `Analise esta bio do Instagram e extraia:

Bio: "${bio}"

Retorne em JSON:
{
  "contato": "telefone encontrado ou null",
  "site": "site próprio (não redes sociais) ou null",
  "linktree": "link de linktree/beacons/bio.link ou null"
}`;

      const resposta = await this.chamarIA(prompt);
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      // Ignorar erros
    }

    return {};
  }

  // Buscar Google Meu Negócio
  private async buscarGMB(page: Page, nomeEmpresa: string, cidade?: string): Promise<{
    linkGMB?: string;
    telefoneGMB?: string;
    horarioFuncionamento?: string;
  }> {
    const query = `${nomeEmpresa} ${cidade || ''}`.trim();
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    try {
      await page.goto(googleUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Extrair dados do painel de conhecimento (GMB)
      const dadosGMB = await page.evaluate(() => {
        // Procurar telefone
        const telefoneEl = document.querySelector('[data-dtype="d3ph"] span') ||
                          document.querySelector('span[aria-label*="telefone"]');
        const telefone = telefoneEl?.textContent || null;

        // Procurar horário
        const horarioEl = document.querySelector('[data-dtype="d3oh"]');
        const horario = horarioEl?.textContent || null;

        // Procurar link do GMB
        const gmbLink = document.querySelector('a[href*="maps.google.com"]')?.getAttribute('href') ||
                       document.querySelector('a[data-url*="maps"]')?.getAttribute('href');

        return { telefone, horario, gmbLink };
      });

      return {
        linkGMB: dadosGMB.gmbLink || undefined,
        telefoneGMB: dadosGMB.telefone || undefined,
        horarioFuncionamento: dadosGMB.horario || undefined,
      };

    } catch (error: any) {
      console.error('     ⚠️  Erro ao buscar GMB:', error.message);
      return {};
    }
  }

  // Verificar se número tem WhatsApp
  private async verificarWhatsApp(page: Page, numero: string): Promise<boolean | null> {
    const numeroFormatado = this.formatarNumeroWhatsApp(numero);
    if (!numeroFormatado) return null;

    const waUrl = `https://wa.me/${numeroFormatado}`;

    try {
      await page.goto(waUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForTimeout(2000);

      const conteudo = await page.evaluate(() => document.body.innerText);
      const urlFinal = page.url();

      // Verificação simples
      const temWhatsApp = urlFinal.includes('send') ||
                         conteudo.includes('Continue to Chat') ||
                         conteudo.includes('Continuar para o chat') ||
                         conteudo.includes('Message');

      return temWhatsApp;

    } catch (error) {
      return null;
    }
  }

  // Chamar IA com retry
  private async chamarIA(prompt: string): Promise<string> {
    const model = this.gemini.getGenerativeModel({ model: this.config.geminiModel });

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
      } catch (error: any) {
        if (tentativa === 3) throw error;
        await new Promise(r => setTimeout(r, 2000 * tentativa));
      }
    }

    throw new Error('Falha ao chamar IA');
  }

  // Executar processamento
  async executar(empresas: EmpresaPlanilha[]): Promise<ResultadoEmpresa[]> {
    console.log('');
    console.log('🚀 Iniciando processamento de empresas...');
    console.log(`📊 Total: ${empresas.length} empresas`);
    console.log('====================================');

    this.browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: null,
    });

    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    try {
      for (let i = 0; i < empresas.length; i++) {
        const empresa = empresas[i];
        console.log('');
        console.log(`📌 [${i + 1}/${empresas.length}] Processando empresa...`);
        console.log(`   Razão Social: ${empresa.razaoSocial}`);
        console.log(`   Município: ${empresa.municipio || 'N/A'}`);

        // 1. Identificar nome da empresa
        const nomeIdentificado = await this.identificarNomeEmpresa(empresa);

        // 2. Buscar Instagram
        const instagramUrl = await this.buscarInstagramNoGoogle(page, nomeIdentificado, empresa.municipio);

        let dadosInstagram: any = {};
        if (instagramUrl) {
          const instaPage = await this.browser!.newPage();
          await instaPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
          dadosInstagram = await this.processarInstagram(instaPage, instagramUrl) || {};
          await instaPage.close();
        }

        // 3. Buscar GMB
        const dadosGMB = await this.buscarGMB(page, nomeIdentificado, empresa.municipio);

        // 4. Verificar WhatsApp dos telefones
        let contatoBioTemWhatsApp: boolean | undefined;
        let telefoneGMBTemWhatsApp: boolean | undefined;

        if (dadosInstagram.contatoBio) {
          contatoBioTemWhatsApp = await this.verificarWhatsApp(page, dadosInstagram.contatoBio) || undefined;
        }

        if (dadosGMB.telefoneGMB) {
          telefoneGMBTemWhatsApp = await this.verificarWhatsApp(page, dadosGMB.telefoneGMB) || undefined;
        }

        // 5. Montar resultado
        const resultado: ResultadoEmpresa = {
          ...empresa,
          nomeIdentificado,
          instagramUrl: instagramUrl || undefined,
          instagramUsername: dadosInstagram.username,
          whatsappBio: dadosInstagram.whatsappBio,
          numeroWhatsappBio: dadosInstagram.numeroWhatsappBio,
          contatoBio: dadosInstagram.contatoBio,
          contatoBioTemWhatsApp,
          siteProprioBio: dadosInstagram.siteProprioBio,
          linkTreeBio: dadosInstagram.linkTreeBio,
          ...dadosGMB,
          telefoneGMBTemWhatsApp,
        };

        this.resultados.push(resultado);

        // Enviar progresso
        if (this.config.onProgresso) {
          this.config.onProgresso(resultado, i + 1, empresas.length);
        }

        console.log(`   ✅ Empresa processada!`);
      }

    } finally {
      await this.browser.close();
    }

    console.log('');
    console.log('====================================');
    console.log(`✅ Processamento concluído! ${this.resultados.length} empresas processadas`);

    return this.resultados;
  }
}
