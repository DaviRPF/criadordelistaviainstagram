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
    console.log('');
    console.log('📂 ========== LEITURA DA PLANILHA ==========');
    console.log(`📁 Tamanho do buffer: ${(buffer.length / 1024).toFixed(2)} KB`);

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    console.log(`📑 Abas encontradas: ${workbook.SheetNames.join(', ')}`);

    const sheetName = workbook.SheetNames[0];
    console.log(`📄 Usando aba: "${sheetName}"`);

    const sheet = workbook.Sheets[sheetName];
    const dados = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    console.log(`📊 Total de linhas na planilha: ${dados.length}`);

    // Primeira linha é o cabeçalho
    const headers = dados[0] as string[];
    console.log(`📋 Cabeçalhos encontrados: ${headers.filter(h => h).join(' | ')}`);

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

    console.log('🔍 Mapeamento de colunas:');
    console.log(`   - Nome Fantasia: coluna ${idxNomeFantasia >= 0 ? idxNomeFantasia : '❌ NÃO ENCONTRADA'}`);
    console.log(`   - Razão Social: coluna ${idxRazaoSocial >= 0 ? idxRazaoSocial : '❌ NÃO ENCONTRADA'}`);
    console.log(`   - CNPJ: coluna ${idxCnpj >= 0 ? idxCnpj : '❌ NÃO ENCONTRADA'}`);
    console.log(`   - Telefone: coluna ${idxTelefone >= 0 ? idxTelefone : '❌ NÃO ENCONTRADA'}`);
    console.log(`   - Município: coluna ${idxMunicipio >= 0 ? idxMunicipio : '❌ NÃO ENCONTRADA'}`);
    console.log(`   - UF: coluna ${idxUf >= 0 ? idxUf : '❌ NÃO ENCONTRADA'}`);

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

    console.log('');
    console.log(`✅ Planilha carregada com sucesso!`);
    console.log(`📊 Total de empresas válidas: ${empresas.length}`);
    console.log(`⏭️  Linhas ignoradas (sem razão social/cnpj): ${dados.length - 1 - empresas.length}`);
    console.log('📂 ==========================================');
    console.log('');
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

    console.log(`     🔎 [GOOGLE] Buscando Instagram...`);
    console.log(`        Query: "${query}"`);
    console.log(`        URL: ${googleUrl}`);

    try {
      console.log(`        ⏳ Navegando para Google...`);
      await page.goto(googleUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(`        ✅ Página carregada`);
      await page.waitForTimeout(2000);

      // Extrair resultados
      console.log(`        🔍 Extraindo resultados da busca...`);
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

      console.log(`        📋 ${resultados.length} resultados encontrados`);

      // Listar resultados para debug
      resultados.forEach((r, idx) => {
        const isInsta = r.url.includes('instagram.com') ? '📱' : '  ';
        console.log(`        ${isInsta} [${idx + 1}] ${r.titulo.substring(0, 40)}... -> ${r.url.substring(0, 60)}...`);
      });

      // Procurar resultado do Instagram
      for (const resultado of resultados) {
        if (resultado.url.includes('instagram.com') &&
            !resultado.url.includes('/explore') &&
            !resultado.url.includes('/accounts')) {
          console.log(`     ✅ [GOOGLE] Instagram encontrado: ${resultado.url}`);
          return resultado.url;
        }
      }

      console.log('     ❌ [GOOGLE] Nenhum perfil do Instagram encontrado nos resultados');
      return null;

    } catch (error: any) {
      console.error(`     ⚠️  [GOOGLE] ERRO: ${error.message}`);
      console.error(`        Stack: ${error.stack?.split('\n')[1] || 'N/A'}`);
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
    console.log(`     📱 [INSTAGRAM] Processando perfil...`);
    console.log(`        URL: ${url}`);

    try {
      console.log(`        🍪 Aplicando cookies do Instagram...`);
      await this.config.instagramAuth.aplicarCookies(page);

      console.log(`        ⏳ Navegando para o perfil...`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(`        ✅ Página carregada`);
      await page.waitForTimeout(3000);

      // Verificar se está no login
      const estaNoLogin = await page.evaluate(() => {
        return window.location.pathname.includes('/accounts/login');
      });

      if (estaNoLogin) {
        console.log('     ⚠️  [INSTAGRAM] PROBLEMA: Redirecionou para login!');
        console.log('        💡 Dica: Faça login no Instagram novamente na interface web');
        return null;
      }

      // Extrair dados
      console.log(`        🔍 Extraindo dados do perfil...`);
      const dados = await page.evaluate(() => {
        const username = window.location.pathname.split('/').filter(Boolean)[0] || '';

        const bio =
          document.querySelector('header section div._aa_c span')?.textContent ||
          document.querySelector('header div._aa_c span')?.textContent ||
          '';

        return { username, bio };
      });

      console.log(`        👤 Username extraído: @${dados.username}`);
      console.log(`        📝 Bio completa: "${dados.bio || '(vazia)'}"`);

      // Extrair WhatsApp da bio
      console.log(`        🔍 Buscando WhatsApp na bio...`);
      const whatsappInfo = this.extrairWhatsAppDaBio(dados.bio);
      if (whatsappInfo.link) {
        console.log(`        ✅ WhatsApp encontrado: ${whatsappInfo.link}`);
      } else {
        console.log(`        ❌ WhatsApp não encontrado na bio`);
      }

      // Extrair contato e links da bio usando IA
      console.log(`        🤖 Usando IA para extrair contatos/links da bio...`);
      const linksInfo = await this.extrairLinksDaBio(dados.bio);
      console.log(`        📞 Contato: ${linksInfo.contato || 'não encontrado'}`);
      console.log(`        🌐 Site: ${linksInfo.site || 'não encontrado'}`);
      console.log(`        🌳 Linktree: ${linksInfo.linktree || 'não encontrado'}`);

      console.log(`     ✅ [INSTAGRAM] Perfil processado com sucesso!`);

      return {
        username: dados.username,
        whatsappBio: whatsappInfo.link || undefined,
        numeroWhatsappBio: whatsappInfo.numero || undefined,
        contatoBio: linksInfo.contato || undefined,
        siteProprioBio: linksInfo.site || undefined,
        linkTreeBio: linksInfo.linktree || undefined,
      };

    } catch (error: any) {
      console.error(`     ⚠️  [INSTAGRAM] ERRO: ${error.message}`);
      console.error(`        Stack: ${error.stack?.split('\n')[1] || 'N/A'}`);
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

    console.log(`     📍 [GMB] Buscando Google Meu Negócio...`);
    console.log(`        Query: "${query}"`);

    try {
      console.log(`        ⏳ Navegando para Google...`);
      await page.goto(googleUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(`        ✅ Página carregada`);
      await page.waitForTimeout(2000);

      // Extrair dados do painel de conhecimento (GMB)
      console.log(`        🔍 Procurando painel de conhecimento (GMB)...`);
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

      console.log(`        📞 Telefone GMB: ${dadosGMB.telefone || 'não encontrado'}`);
      console.log(`        🕐 Horário: ${dadosGMB.horario || 'não encontrado'}`);
      console.log(`        🔗 Link Maps: ${dadosGMB.gmbLink ? 'encontrado' : 'não encontrado'}`);

      if (dadosGMB.telefone || dadosGMB.horario || dadosGMB.gmbLink) {
        console.log(`     ✅ [GMB] Dados encontrados!`);
      } else {
        console.log(`     ❌ [GMB] Nenhum dado encontrado`);
      }

      return {
        linkGMB: dadosGMB.gmbLink || undefined,
        telefoneGMB: dadosGMB.telefone || undefined,
        horarioFuncionamento: dadosGMB.horario || undefined,
      };

    } catch (error: any) {
      console.error(`     ⚠️  [GMB] ERRO: ${error.message}`);
      return {};
    }
  }

  // Verificar se número tem WhatsApp
  private async verificarWhatsApp(page: Page, numero: string): Promise<boolean | null> {
    console.log(`     📲 [WHATSAPP] Verificando número: ${numero}`);

    const numeroFormatado = this.formatarNumeroWhatsApp(numero);
    if (!numeroFormatado) {
      console.log(`        ❌ Número inválido, não foi possível formatar`);
      return null;
    }

    const waUrl = `https://wa.me/${numeroFormatado}`;
    console.log(`        🔗 URL: ${waUrl}`);

    try {
      console.log(`        ⏳ Verificando...`);
      await page.goto(waUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForTimeout(2000);

      const conteudo = await page.evaluate(() => document.body.innerText);
      const urlFinal = page.url();

      // Verificação simples
      const temWhatsApp = urlFinal.includes('send') ||
                         conteudo.includes('Continue to Chat') ||
                         conteudo.includes('Continuar para o chat') ||
                         conteudo.includes('Message');

      if (temWhatsApp) {
        console.log(`        ✅ Número TEM WhatsApp!`);
      } else {
        console.log(`        ❌ Número NÃO tem WhatsApp`);
      }

      return temWhatsApp;

    } catch (error: any) {
      console.log(`        ⚠️  Erro ao verificar: ${error.message}`);
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
    const inicioTotal = Date.now();

    console.log('');
    console.log('🚀 ========================================');
    console.log('🚀 INICIANDO PROCESSAMENTO DE EMPRESAS');
    console.log('🚀 ========================================');
    console.log(`📊 Total de empresas: ${empresas.length}`);
    console.log(`🤖 Modelo IA: ${this.config.geminiModel}`);
    console.log(`⏰ Início: ${new Date().toLocaleString('pt-BR')}`);
    console.log('');

    console.log('🌐 Iniciando navegador Puppeteer...');
    this.browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: null,
    });
    console.log('✅ Navegador iniciado com sucesso!');

    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    console.log('✅ Página principal criada');
    console.log('');

    try {
      for (let i = 0; i < empresas.length; i++) {
        const inicioEmpresa = Date.now();
        const empresa = empresas[i];

        console.log('');
        console.log('╔════════════════════════════════════════════════════════════════');
        console.log(`║ 📌 EMPRESA ${i + 1} de ${empresas.length}`);
        console.log('╠════════════════════════════════════════════════════════════════');
        console.log(`║ 📋 Razão Social: ${empresa.razaoSocial}`);
        console.log(`║ 🏷️  Nome Fantasia: ${empresa.nomeFantasia || '(não informado)'}`);
        console.log(`║ 📍 Município/UF: ${empresa.municipio || 'N/A'}/${empresa.uf || 'N/A'}`);
        console.log(`║ 📞 Telefone: ${empresa.telefone || '(não informado)'}`);
        console.log(`║ 🏢 CNPJ: ${empresa.cnpj || 'N/A'}`);
        console.log('╚════════════════════════════════════════════════════════════════');
        console.log('');

        // 1. Identificar nome da empresa
        console.log('   📝 ETAPA 1: Identificar nome comercial');
        console.log('   ─────────────────────────────────────');
        const nomeIdentificado = await this.identificarNomeEmpresa(empresa);
        console.log(`   ✅ Nome identificado: "${nomeIdentificado}"`);
        console.log('');

        // 2. Buscar Instagram
        console.log('   🔎 ETAPA 2: Buscar Instagram no Google');
        console.log('   ─────────────────────────────────────');
        const instagramUrl = await this.buscarInstagramNoGoogle(page, nomeIdentificado, empresa.municipio);
        console.log('');

        // 3. Processar Instagram (se encontrado)
        let dadosInstagram: any = {};
        if (instagramUrl) {
          console.log('   📱 ETAPA 3: Processar perfil do Instagram');
          console.log('   ─────────────────────────────────────');
          const instaPage = await this.browser!.newPage();
          await instaPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
          dadosInstagram = await this.processarInstagram(instaPage, instagramUrl) || {};
          await instaPage.close();
          console.log('');
        } else {
          console.log('   ⏭️  ETAPA 3: Pulando (Instagram não encontrado)');
          console.log('');
        }

        // 4. Buscar GMB
        console.log('   📍 ETAPA 4: Buscar Google Meu Negócio');
        console.log('   ─────────────────────────────────────');
        const dadosGMB = await this.buscarGMB(page, nomeIdentificado, empresa.municipio);
        console.log('');

        // 5. Verificar WhatsApp dos telefones
        console.log('   📲 ETAPA 5: Verificar WhatsApp');
        console.log('   ─────────────────────────────────────');
        let contatoBioTemWhatsApp: boolean | undefined;
        let telefoneGMBTemWhatsApp: boolean | undefined;

        if (dadosInstagram.contatoBio) {
          console.log(`   Verificando telefone da bio: ${dadosInstagram.contatoBio}`);
          contatoBioTemWhatsApp = await this.verificarWhatsApp(page, dadosInstagram.contatoBio) || undefined;
        } else {
          console.log('   ⏭️  Pulando verificação (sem telefone na bio)');
        }

        if (dadosGMB.telefoneGMB) {
          console.log(`   Verificando telefone GMB: ${dadosGMB.telefoneGMB}`);
          telefoneGMBTemWhatsApp = await this.verificarWhatsApp(page, dadosGMB.telefoneGMB) || undefined;
        } else {
          console.log('   ⏭️  Pulando verificação (sem telefone GMB)');
        }
        console.log('');

        // 6. Montar resultado
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

        const tempoEmpresa = ((Date.now() - inicioEmpresa) / 1000).toFixed(1);
        console.log('   ════════════════════════════════════════');
        console.log(`   ✅ EMPRESA ${i + 1} PROCESSADA em ${tempoEmpresa}s`);
        console.log('   ════════════════════════════════════════');
        console.log('   📊 RESUMO:');
        console.log(`      - Nome: ${nomeIdentificado}`);
        console.log(`      - Instagram: ${instagramUrl ? `@${dadosInstagram.username}` : '❌ não encontrado'}`);
        console.log(`      - WhatsApp Bio: ${dadosInstagram.whatsappBio || '❌'}`);
        console.log(`      - Telefone GMB: ${dadosGMB.telefoneGMB || '❌'}`);
        console.log(`      - Site: ${dadosInstagram.siteProprioBio || '❌'}`);
        console.log('');
      }

    } catch (error: any) {
      console.error('');
      console.error('❌ ========================================');
      console.error('❌ ERRO DURANTE O PROCESSAMENTO');
      console.error('❌ ========================================');
      console.error(`Mensagem: ${error.message}`);
      console.error(`Stack: ${error.stack}`);
      console.error('');
      throw error;

    } finally {
      console.log('🔄 Fechando navegador...');
      await this.browser.close();
      console.log('✅ Navegador fechado');
    }

    const tempoTotal = ((Date.now() - inicioTotal) / 1000 / 60).toFixed(1);
    console.log('');
    console.log('🏁 ========================================');
    console.log('🏁 PROCESSAMENTO CONCLUÍDO!');
    console.log('🏁 ========================================');
    console.log(`📊 Empresas processadas: ${this.resultados.length}`);
    console.log(`⏱️  Tempo total: ${tempoTotal} minutos`);
    console.log(`⏰ Fim: ${new Date().toLocaleString('pt-BR')}`);
    console.log('');

    // Resumo final
    const comInstagram = this.resultados.filter(r => r.instagramUrl).length;
    const comWhatsApp = this.resultados.filter(r => r.whatsappBio || r.contatoBioTemWhatsApp || r.telefoneGMBTemWhatsApp).length;
    const comGMB = this.resultados.filter(r => r.linkGMB || r.telefoneGMB).length;

    console.log('📈 ESTATÍSTICAS:');
    console.log(`   - Com Instagram: ${comInstagram}/${this.resultados.length} (${((comInstagram/this.resultados.length)*100).toFixed(0)}%)`);
    console.log(`   - Com WhatsApp: ${comWhatsApp}/${this.resultados.length} (${((comWhatsApp/this.resultados.length)*100).toFixed(0)}%)`);
    console.log(`   - Com GMB: ${comGMB}/${this.resultados.length} (${((comGMB/this.resultados.length)*100).toFixed(0)}%)`);
    console.log('');

    return this.resultados;
  }
}
