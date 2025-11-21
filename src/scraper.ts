import puppeteer, { Browser, Page } from 'puppeteer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Solver } from '@2captcha/captcha-solver';
import { InstagramAuth } from './instagram-auth';

interface ProspectorConfig {
  tipoEstabelecimento: string;
  cidade: string;
  limite?: number;
  geminiApiKey: string;
  twoCaptchaApiKey: string;
  instagramAuth: InstagramAuth;
  onProgresso?: (resultado: Resultado, atual: number, total: number | string) => void;
}

interface Resultado {
  nome: string;
  username: string;
  instagramUrl: string;
  contato?: string;
  linkTree?: string;
  siteProprio?: string;
  whatsappLinkTree?: string;
  numeroWhatsappLinkTree?: string;
  cnpjUrl?: string;
  situacao?: string;
  ativaDesde?: string;
  tipoUnidade?: string;
  enquadramentoPorte?: string;
  sociosAdministradores?: string[];
}

export class ProspectorScraper {
  private config: ProspectorConfig;
  private browser: Browser | null = null;
  private gemini: GoogleGenerativeAI;
  private solver: any;
  private resultados: Resultado[] = [];

  constructor(config: ProspectorConfig) {
    this.config = config;
    this.gemini = new GoogleGenerativeAI(config.geminiApiKey);
    this.solver = new Solver(config.twoCaptchaApiKey);

    console.log('🔧 Configuração do Scraper:');
    console.log('  API Keys carregadas:', {
      gemini: config.geminiApiKey ? '✅' : '❌',
      twoCaptcha: config.twoCaptchaApiKey ? '✅' : '❌'
    });
  }

  async executar(): Promise<Resultado[]> {
    try {
      console.log('');
      console.log('🚀 Iniciando execução do scraper...');
      console.log('====================================');

      await this.iniciarBrowser();
      await this.buscarNoGoogle();
      await this.fecharBrowser();

      console.log('');
      console.log('✅ Scraper finalizado com sucesso!');
      console.log(`📊 Total de resultados: ${this.resultados.length}`);
      console.log('====================================');

      return this.resultados;

    } catch (error: any) {
      console.error('❌ Erro fatal no scraper:', error.message);
      await this.fecharBrowser();
      throw error;
    }
  }

  private async iniciarBrowser(): Promise<void> {
    console.log('');
    console.log('🌐 Iniciando navegador Puppeteer...');

    this.browser = await puppeteer.launch({
      headless: false, // Mostra o navegador
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    console.log('✅ Navegador iniciado com sucesso');
  }

  private async fecharBrowser(): Promise<void> {
    if (this.browser) {
      console.log('');
      console.log('🔒 Fechando navegador...');
      await this.browser.close();
      console.log('✅ Navegador fechado');
    }
  }

  private async buscarNoGoogle(): Promise<void> {
    if (!this.browser) throw new Error('Browser não iniciado');

    const page = await this.browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    const termoBusca = `${this.config.tipoEstabelecimento} ${this.config.cidade} instagram`;

    console.log('');
    console.log('🔍 Buscando no Google:');
    console.log(`  Termo: "${termoBusca}"`);

    await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
    console.log('✅ Google carregado');

    // Verificar CAPTCHA
    await this.verificarEResolverCaptcha(page);

    // Fazer a busca
    console.log('⌨️  Digitando termo de busca...');
    await page.type('textarea[name="q"]', termoBusca);
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('✅ Resultados da busca carregados');

    // Processar resultados
    await this.processarResultadosGoogle(page);
  }

  private async verificarEResolverCaptcha(page: Page): Promise<void> {
    console.log('');
    console.log('🔐 Verificando presença de CAPTCHA...');

    const temCaptcha = await page.evaluate(() => {
      return document.querySelector('.g-recaptcha') !== null ||
             document.querySelector('#recaptcha') !== null ||
             document.body.innerText.includes('captcha');
    });

    if (temCaptcha) {
      console.log('⚠️  CAPTCHA detectado! Resolvendo com 2Captcha...');

      try {
        const siteKey = await page.evaluate(() => {
          const element = document.querySelector('.g-recaptcha');
          return element ? element.getAttribute('data-sitekey') : null;
        });

        if (siteKey) {
          console.log('🔑 Site Key encontrada:', siteKey);
          console.log('⏳ Enviando para 2Captcha resolver...');

          const result = await this.solver.recaptcha(siteKey, page.url());
          console.log('✅ CAPTCHA resolvido com sucesso!');

          // Injetar resposta do CAPTCHA
          await page.evaluate((token) => {
            (document.getElementById('g-recaptcha-response') as any).value = token;
          }, result.data);

          await page.click('button[type="submit"]');
          await page.waitForNavigation({ waitUntil: 'networkidle2' });
          console.log('✅ CAPTCHA submetido com sucesso');
        }
      } catch (error: any) {
        console.error('❌ Erro ao resolver CAPTCHA:', error.message);
        console.log('⚠️  Continuando sem resolver o CAPTCHA...');
      }
    } else {
      console.log('✅ Nenhum CAPTCHA detectado');
    }
  }

  private async extrairResultadosGoogle(page: Page): Promise<{ titulo: string; url: string }[]> {
    return await page.evaluate(() => {
      const resultados: { titulo: string; url: string }[] = [];

      // Tentar múltiplos seletores (Google muda frequentemente)
      const seletoresPossiveis = [
        'div.g',           // Seletor antigo
        'div[data-sokoban-container]',  // Seletor mais recente
        'div.Gx5Zad',      // Alternativo
        '.MjjYud',         // Outro possível
        'div[jscontroller]' // Genérico
      ];

      let elementos: NodeListOf<Element> | null = null;

      for (const seletor of seletoresPossiveis) {
        const els = document.querySelectorAll(seletor);
        console.log(`Testando seletor "${seletor}": ${els.length} elementos`);
        if (els.length > 0) {
          elementos = els;
          break;
        }
      }

      if (!elementos || elementos.length === 0) {
        // Tentar pegar todos os links com h3
        const todosH3 = document.querySelectorAll('h3');
        console.log(`Fallback: encontrados ${todosH3.length} elementos h3`);

        todosH3.forEach((h3: Element) => {
          const link = h3.closest('a') || h3.querySelector('a') || h3.parentElement?.querySelector('a');
          if (link && link instanceof HTMLAnchorElement) {
            resultados.push({
              titulo: h3.textContent || '',
              url: link.href
            });
          }
        });
      } else {
        elementos.forEach((el: Element) => {
          const link = el.querySelector('a');
          const titulo = el.querySelector('h3');

          if (link && titulo && link instanceof HTMLAnchorElement) {
            resultados.push({
              titulo: titulo.textContent || '',
              url: link.href
            });
          }
        });
      }

      return resultados;
    });
  }

  private async processarResultadosGoogle(page: Page): Promise<void> {
    console.log('');
    console.log('📄 Processando resultados da busca...');

    let paginaAtual = 1;
    let contadorResultados = 0;

    while (true) {
      console.log('');
      console.log(`📖 Página ${paginaAtual} do Google`);

      // Pegar todos os links de resultados
      const links = await this.extrairResultadosGoogle(page);

      console.log(`  Encontrados ${links.length} resultados nesta página`);

      // Verificar se ainda tem resultados do Instagram usando IA
      let temMaisInstagram = false;

      for (const link of links) {
        console.log('');
        console.log(`  🔎 Analisando: ${link.titulo}`);
        console.log(`     URL: ${link.url}`);

        const ehInstagram = await this.verificarSeEhInstagram(link.titulo, link.url);

        if (ehInstagram) {
          console.log('     ✅ É do Instagram! Processando...');

          try {
            contadorResultados++;
            const total = this.config.limite || '?';
            await this.processarPerfilInstagram(link.url, contadorResultados, total);
            temMaisInstagram = true;

            // Verificar limite
            if (this.config.limite && contadorResultados >= this.config.limite) {
              console.log('');
              console.log(`🎯 Limite de ${this.config.limite} resultados atingido!`);
              return;
            }
          } catch (error: any) {
            console.error('     ❌ Erro ao processar perfil:', error.message);
          }
        } else {
          console.log('     ⏭️  Não é do Instagram, pulando...');
        }
      }

      // Se não tem mais Instagram, parar
      if (!temMaisInstagram) {
        console.log('');
        console.log('⚠️  Não há mais resultados do Instagram. Finalizando...');
        break;
      }

      // Tentar ir para próxima página
      const temProximaPagina = await this.irParaProximaPaginaGoogle(page);
      if (!temProximaPagina) {
        console.log('');
        console.log('📄 Não há mais páginas disponíveis');
        break;
      }

      paginaAtual++;
    }

    console.log('');
    console.log(`✅ Processamento concluído! Total: ${contadorResultados} perfis`);
  }

  private async verificarSeEhInstagram(titulo: string, url: string): Promise<boolean> {
    // Verificação simples primeiro
    if (url.includes('instagram.com')) {
      return true;
    }

    // Usar IA para validar o título
    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `Analise o seguinte título de resultado do Google e URL:

Título: "${titulo}"
URL: "${url}"

Este resultado é de um perfil do Instagram? Responda apenas "SIM" ou "NÃO".`;

      const result = await model.generateContent(prompt);
      const resposta = result.response.text().trim().toUpperCase();

      console.log(`     🤖 IA respondeu: ${resposta}`);

      return resposta.includes('SIM');
    } catch (error: any) {
      console.error('     ⚠️  Erro na IA, usando verificação simples:', error.message);
      return url.includes('instagram');
    }
  }

  private async processarPerfilInstagram(url: string, atual: number, total: number | string): Promise<void> {
    if (!this.browser) return;

    console.log('');
    console.log(`📱 Estabelecimento ${atual} de ${total}`);
    console.log('   Abrindo perfil do Instagram...');

    const page = await this.browser.newPage();

    try {
      // Setar user agent para parecer navegador real
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Aplicar cookies do Instagram se estiver logado
      await this.config.instagramAuth.aplicarCookies(page);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log('✅ Perfil carregado');

      // Esperar o conteúdo carregar
      await page.waitForTimeout(3000);

      // Verificar se está na página de login
      const estaNoLogin = await page.evaluate(() => {
        return window.location.pathname.includes('/accounts/login') ||
               document.body.innerText.includes('Log in to Instagram') ||
               document.body.innerText.includes('accountslogin');
      });

      if (estaNoLogin) {
        console.log('⚠️  Instagram redirecionou para login, pulando este perfil...');
        await page.close();
        return;
      }

      // Extrair dados do perfil com múltiplos seletores
      const dadosPerfil = await page.evaluate(() => {
        // Tentar múltiplos seletores para nome
        const nome =
          document.querySelector('header section h2')?.textContent ||
          document.querySelector('header h2')?.textContent ||
          document.querySelector('header h1')?.textContent ||
          document.querySelector('h2._aacl._aacs._aact._aacx._aada')?.textContent ||
          document.querySelector('span.x1lliihq.x1plvlek.xryxfnj')?.textContent ||
          '';

        // Username da URL é mais confiável
        const username = window.location.pathname.split('/').filter(Boolean)[0] || '';

        // Tentar múltiplos seletores para bio
        const bio =
          document.querySelector('header section div._aa_c span')?.textContent ||
          document.querySelector('header div._aa_c span')?.textContent ||
          document.querySelector('div.-vDIg span')?.textContent ||
          document.querySelector('h1 + div')?.textContent ||
          Array.from(document.querySelectorAll('span')).find(el =>
            el.textContent && el.textContent.length > 20 && el.textContent.length < 200
          )?.textContent ||
          '';

        return { nome, username, bio };
      });

      console.log('  📋 Dados extraídos:');
      console.log('     Nome:', dadosPerfil.nome);
      console.log('     Username:', dadosPerfil.username);
      console.log('     Bio:', dadosPerfil.bio.substring(0, 100) + '...');

      // Se não conseguiu pegar o username, pular
      if (!dadosPerfil.username || dadosPerfil.username === 'accountslogin') {
        console.log('⚠️  Username inválido, pulando perfil...');
        await page.close();
        return;
      }

      // Verificar contato na bio usando IA
      const contato = await this.extrairContatoDaBio(dadosPerfil.bio);
      if (contato) {
        console.log('     📞 Contato encontrado:', contato);
      }

      // Extrair links (Linktree/Site próprio) da bio
      const { linkTree, siteProprio } = await this.extrairLinksDaBio(dadosPerfil.bio);

      let whatsappLinkTree: string | undefined = undefined;
      let numeroWhatsappLinkTree: string | undefined = undefined;

      if (linkTree) {
        console.log('     🌳 Linktree encontrado:', linkTree);

        // Processar Linktree para buscar WhatsApp
        const dadosLinktree = await this.processarLinktree(linkTree);
        whatsappLinkTree = dadosLinktree.whatsappLink || undefined;
        numeroWhatsappLinkTree = dadosLinktree.numeroWhatsapp || undefined;
      }

      if (siteProprio) {
        console.log('     🌐 Site próprio encontrado:', siteProprio);
      }

      // Identificar nome real do estabelecimento
      // Se nome estiver vazio, usar o username
      const nomeParaIA = dadosPerfil.nome || dadosPerfil.username;
      const nomeReal = await this.identificarNomeReal(nomeParaIA, dadosPerfil.username);
      console.log('     🏢 Nome real identificado:', nomeReal);

      // Buscar dados de CNPJ
      const dadosCnpj = await this.buscarDadosCNPJ(nomeReal);

      // Salvar resultado
      const resultado: Resultado = {
        nome: nomeReal,
        username: dadosPerfil.username,
        instagramUrl: url,
        contato: contato || undefined,
        linkTree: linkTree || undefined,
        siteProprio: siteProprio || undefined,
        whatsappLinkTree: whatsappLinkTree,
        numeroWhatsappLinkTree: numeroWhatsappLinkTree,
        ...dadosCnpj
      };

      this.resultados.push(resultado);

      // Enviar progresso em tempo real
      if (this.config.onProgresso) {
        this.config.onProgresso(resultado, atual, total);
      }

      console.log('✅ Perfil processado com sucesso!');

    } catch (error: any) {
      console.error('❌ Erro ao processar perfil Instagram:', error.message);
    } finally {
      await page.close();
    }
  }

  private async extrairContatoDaBio(bio: string): Promise<string | null> {
    console.log('');
    console.log('     🤖 Usando IA para extrair contato da bio...');

    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `Analise a seguinte bio do Instagram e identifique se há número de telefone ou link do WhatsApp:

Bio: "${bio}"

Se encontrar algum contato, retorne APENAS o número ou link. Se não encontrar, retorne "NENHUM".`;

      const result = await model.generateContent(prompt);
      const resposta = result.response.text().trim();

      console.log(`     🤖 IA encontrou: ${resposta}`);

      if (resposta === 'NENHUM' || resposta.includes('NENHUM')) {
        return null;
      }

      return resposta;
    } catch (error: any) {
      console.error('     ⚠️  Erro ao extrair contato:', error.message);
      return null;
    }
  }

  private async extrairLinksDaBio(bio: string): Promise<{ linkTree: string | null, siteProprio: string | null }> {
    console.log('');
    console.log('     🔗 Usando IA para extrair links da bio...');

    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `Analise a seguinte bio do Instagram e identifique se há:
1. Link do Linktree (linktr.ee ou beacons.ai ou outros serviços similares de link in bio)
2. Site próprio (qualquer outro link que seja um site próprio da empresa)

Bio: "${bio}"

Responda EXATAMENTE neste formato JSON:
{
  "linktree": "URL_DO_LINKTREE ou null",
  "site": "URL_DO_SITE_PROPRIO ou null"
}

Se não encontrar algum dos links, use null.`;

      const result = await model.generateContent(prompt);
      const resposta = result.response.text().trim();

      console.log(`     🤖 IA respondeu: ${resposta}`);

      // Tentar extrair JSON da resposta
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const dados = JSON.parse(jsonMatch[0]);
        return {
          linkTree: dados.linktree !== 'null' && dados.linktree ? dados.linktree : null,
          siteProprio: dados.site !== 'null' && dados.site ? dados.site : null
        };
      }

      return { linkTree: null, siteProprio: null };
    } catch (error: any) {
      console.error('     ⚠️  Erro ao extrair links:', error.message);
      return { linkTree: null, siteProprio: null };
    }
  }

  private async processarLinktree(linktreeUrl: string): Promise<{ whatsappLink: string | null, numeroWhatsapp: string | null }> {
    if (!this.browser) return { whatsappLink: null, numeroWhatsapp: null };

    console.log('');
    console.log('     🌳 Processando Linktree...');
    console.log('     🔗 URL:', linktreeUrl);

    const page = await this.browser.newPage();

    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.goto(linktreeUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      console.log('     ✅ Linktree carregado');
      await page.waitForTimeout(2000);

      // Extrair todos os links da página
      const links = await page.evaluate(() => {
        const elementos = Array.from(document.querySelectorAll('a[href]'));
        return elementos.map(el => ({
          href: (el as HTMLAnchorElement).href,
          text: el.textContent?.trim() || ''
        }));
      });

      console.log(`     🔍 Encontrados ${links.length} links no Linktree`);

      // Usar IA para identificar link do WhatsApp
      console.log('     🤖 Usando IA para identificar link do WhatsApp...');

      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const linksTexto = links.map((link, index) =>
        `${index + 1}. Texto: "${link.text}" | URL: ${link.href}`
      ).join('\n');

      const prompt = `Analise a seguinte lista de links extraídos de uma página Linktree e identifique qual é o link do WhatsApp:

${linksTexto}

Procure por:
- Links que contenham wa.me, whatsapp.com, api.whatsapp.com
- Links com texto que mencione WhatsApp, Zap, contato
- Números de telefone em links

Responda EXATAMENTE neste formato JSON:
{
  "encontrou": true ou false,
  "indice": número do item (1, 2, 3...) ou null,
  "link": "URL_COMPLETA" ou null,
  "numero": "NUMERO_TELEFONE_EXTRAIDO" ou null
}

Se não encontrar nenhum link do WhatsApp, retorne encontrou: false.`;

      const result = await model.generateContent(prompt);
      const resposta = result.response.text().trim();

      console.log('     🤖 IA respondeu:', resposta.substring(0, 150));

      // Extrair JSON da resposta
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('     ⚠️  IA não retornou JSON válido');
        await page.close();
        return { whatsappLink: null, numeroWhatsapp: null };
      }

      const dados = JSON.parse(jsonMatch[0]);

      if (dados.encontrou && dados.link) {
        console.log('     ✅ Link do WhatsApp encontrado pela IA:', dados.link);

        if (dados.numero) {
          console.log('     📱 Número extraído pela IA:', dados.numero);
        }

        await page.close();
        return {
          whatsappLink: dados.link,
          numeroWhatsapp: dados.numero || null
        };
      }

      console.log('     ⚠️  IA não encontrou link do WhatsApp no Linktree');
      await page.close();
      return { whatsappLink: null, numeroWhatsapp: null };

    } catch (error: any) {
      console.error('     ❌ Erro ao processar Linktree:', error.message);
      await page.close();
      return { whatsappLink: null, numeroWhatsapp: null };
    }
  }

  private async identificarNomeReal(nome: string, username: string): Promise<string> {
    console.log('');
    console.log('     🤖 Usando IA para identificar nome real...');

    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `Você receberá dois textos sobre um estabelecimento do Instagram:

Texto 1: "${nome}"
Texto 2: "${username}"

REGRAS:
1. Se o Texto 1 tiver conteúdo válido (não vazio), use-o como base para o nome
2. Se o Texto 1 estiver vazio, use o Texto 2
3. Formate o nome de forma legível: remova underscores, capitalize palavras
4. Retorne APENAS o nome formatado, sem explicações

Exemplo:
- "loucosporpizza" → "Loucos Por Pizza"
- "pizzaria_da_vila" → "Pizzaria da Vila"

RESPOSTA (apenas o nome):`;

      const result = await model.generateContent(prompt);
      let nomeReal = result.response.text().trim();

      // Limpar qualquer texto extra que a IA possa ter adicionado
      nomeReal = nomeReal.split('\n')[0]; // Pegar só a primeira linha
      nomeReal = nomeReal.replace(/^[*-]\s*/, ''); // Remover bullet points
      nomeReal = nomeReal.replace(/["'`]/g, ''); // Remover aspas

      // Se a resposta for muito longa (>100 caracteres), provavelmente está errada
      if (nomeReal.length > 100) {
        console.log(`     ⚠️  Resposta da IA muito longa, usando fallback`);
        nomeReal = nome || username;
      }

      console.log(`     🤖 IA identificou: ${nomeReal}`);

      return nomeReal;
    } catch (error: any) {
      console.error('     ⚠️  Erro ao identificar nome real:', error.message);
      return nome || username;
    }
  }

  private async buscarDadosCNPJ(nomeEstabelecimento: string): Promise<Partial<Resultado>> {
    if (!this.browser) return {};

    console.log('');
    console.log('🏢 Buscando dados de CNPJ...');
    console.log(`  Nome: ${nomeEstabelecimento}`);

    const page = await this.browser.newPage();

    try {
      // Primeiro tentar Econodata
      const termoBusca = `${nomeEstabelecimento} ${this.config.cidade} econodata`;
      console.log(`  🔍 Buscando: "${termoBusca}"`);

      await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
      await page.type('textarea[name="q"]', termoBusca);
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });

      // Pegar resultados
      const resultados = await this.extrairResultadosGoogle(page);

      console.log(`  📊 Encontrados ${resultados.length} resultados`);

      // Usar IA para identificar o resultado correto
      const urlCorreta = await this.identificarResultadoCNPJCorreto(resultados, nomeEstabelecimento, 'econodata');

      if (urlCorreta) {
        console.log('  ✅ URL Econodata encontrada:', urlCorreta);
        const dados = await this.extrairDadosEconodata(page, urlCorreta);
        await page.close();
        return dados;
      }

      // Se não encontrou, tentar CNPJBiz
      console.log('  ⚠️  Não encontrado no Econodata, tentando CNPJBiz...');

      const termoBuscaBiz = `${nomeEstabelecimento} ${this.config.cidade} cnpjbiz`;
      await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
      await page.evaluate(() => (document.querySelector('textarea[name="q"]') as any).value = '');
      await page.type('textarea[name="q"]', termoBuscaBiz);
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });

      const resultadosBiz = await this.extrairResultadosGoogle(page);

      const urlCorretaBiz = await this.identificarResultadoCNPJCorreto(resultadosBiz, nomeEstabelecimento, 'cnpjbiz');

      if (urlCorretaBiz) {
        console.log('  ✅ URL CNPJBiz encontrada:', urlCorretaBiz);
        const dados = await this.extrairDadosCNPJBiz(page, urlCorretaBiz);
        await page.close();
        return dados;
      }

      console.log('  ⚠️  Dados de CNPJ não encontrados');
      await page.close();
      return {};

    } catch (error: any) {
      console.error('  ❌ Erro ao buscar CNPJ:', error.message);
      await page.close();
      return {};
    }
  }

  private async identificarResultadoCNPJCorreto(
    resultados: { titulo: string; url: string }[],
    nomeEstabelecimento: string,
    fonte: string
  ): Promise<string | null> {
    console.log('');
    console.log(`  🤖 Usando IA para identificar resultado correto do ${fonte}...`);

    try {
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const listaResultados = resultados.map((r, i) =>
        `${i + 1}. Título: "${r.titulo}" | URL: ${r.url}`
      ).join('\n');

      const prompt = `Analise os seguintes resultados do Google e identifique qual é o resultado correto do ${fonte} para o estabelecimento "${nomeEstabelecimento}" na cidade "${this.config.cidade}":

${listaResultados}

IMPORTANTE: Retorne APENAS um número (1, 2, 3...) ou a palavra "NENHUM". Nada mais.

Critérios:
1. O URL deve ser do site ${fonte}
2. O título deve mencionar o estabelecimento e/ou a cidade
3. Se nenhum resultado atender, retorne "NENHUM"

RESPOSTA (apenas o número ou NENHUM):`;

      const result = await model.generateContent(prompt);
      let resposta = result.response.text().trim();

      // Extrair apenas o primeiro número da resposta (caso a IA tenha dado explicações)
      const primeiraLinha = resposta.split('\n')[0].trim();
      const numeroMatch = primeiraLinha.match(/\d+/);

      console.log(`  🤖 IA escolheu: ${primeiraLinha}`);

      if (primeiraLinha.toUpperCase().includes('NENHUM')) {
        return null;
      }

      if (numeroMatch) {
        const numero = parseInt(numeroMatch[0]);
        if (numero > 0 && numero <= resultados.length) {
          return resultados[numero - 1].url;
        }
      }

      return null;
    } catch (error: any) {
      console.error('  ⚠️  Erro ao identificar resultado:', error.message);
      return null;
    }
  }

  private async extrairDadosEconodata(page: Page, url: string): Promise<Partial<Resultado>> {
    console.log('');
    console.log('  📊 Extraindo dados do Econodata...');

    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      await page.waitForTimeout(2000); // Esperar conteúdo carregar

      // Extrair todo o texto visível da página
      const textoCompleto = await page.evaluate(() => {
        // Remover scripts, styles e elementos ocultos
        const elementos = Array.from(document.querySelectorAll('script, style, noscript'));
        elementos.forEach(el => el.remove());

        return document.body.innerText;
      });

      console.log('  🤖 Usando IA para extrair dados da página...');

      // Usar IA para extrair os dados
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `Analise o seguinte texto extraído de uma página do Econodata sobre uma empresa e extraia as seguintes informações:

1. Situação da empresa (ex: ATIVA, INAPTA, BAIXADA, etc)
2. Data de abertura / Ativa desde (ex: 01/01/2020)
3. Tipo de unidade (ex: MATRIZ, FILIAL)
4. Enquadramento de porte (ex: ME, EPP, DEMAIS, MEI)
5. Lista de sócios e administradores (nomes das pessoas)

Texto da página:
"""
${textoCompleto.substring(0, 8000)}
"""

Responda EXATAMENTE neste formato JSON:
{
  "situacao": "valor ou null",
  "ativaDesde": "valor ou null",
  "tipoUnidade": "valor ou null",
  "enquadramentoPorte": "valor ou null",
  "socios": ["nome1", "nome2"] ou []
}

Se não encontrar alguma informação, use null ou [] para socios.`;

      const result = await model.generateContent(prompt);
      const resposta = result.response.text().trim();

      console.log('  🤖 IA respondeu:', resposta.substring(0, 200));

      // Extrair JSON da resposta
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('IA não retornou JSON válido');
      }

      const dados = JSON.parse(jsonMatch[0]);

      console.log('  ✅ Dados extraídos do Econodata');
      console.log('     📋 Situação:', dados.situacao || 'N/A');
      console.log('     📅 Ativa desde:', dados.ativaDesde || 'N/A');
      console.log('     🏢 Tipo de unidade:', dados.tipoUnidade || 'N/A');
      console.log('     📊 Enquadramento de porte:', dados.enquadramentoPorte || 'N/A');
      console.log('     👥 Sócios/Administradores:', dados.socios && dados.socios.length > 0 ? dados.socios.join(', ') : 'N/A');

      return {
        cnpjUrl: url,
        situacao: dados.situacao !== 'null' && dados.situacao ? dados.situacao : undefined,
        ativaDesde: dados.ativaDesde !== 'null' && dados.ativaDesde ? dados.ativaDesde : undefined,
        tipoUnidade: dados.tipoUnidade !== 'null' && dados.tipoUnidade ? dados.tipoUnidade : undefined,
        enquadramentoPorte: dados.enquadramentoPorte !== 'null' && dados.enquadramentoPorte ? dados.enquadramentoPorte : undefined,
        sociosAdministradores: dados.socios && dados.socios.length > 0 ? dados.socios : []
      };
    } catch (error: any) {
      console.error('  ❌ Erro ao extrair dados Econodata:', error.message);
      return { cnpjUrl: url };
    }
  }

  private async extrairDadosCNPJBiz(page: Page, url: string): Promise<Partial<Resultado>> {
    console.log('');
    console.log('  📊 Extraindo dados do CNPJBiz...');

    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      await page.waitForTimeout(2000); // Esperar conteúdo carregar

      // Extrair todo o texto visível da página
      const textoCompleto = await page.evaluate(() => {
        // Remover scripts, styles e elementos ocultos
        const elementos = Array.from(document.querySelectorAll('script, style, noscript'));
        elementos.forEach(el => el.remove());

        return document.body.innerText;
      });

      console.log('  🤖 Usando IA para extrair dados da página...');

      // Usar IA para extrair os dados
      const model = this.gemini.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `Analise o seguinte texto extraído de uma página do CNPJBiz sobre uma empresa e extraia as seguintes informações:

1. Situação da empresa (ex: ATIVA, INAPTA, BAIXADA, etc)
2. Data de abertura / Ativa desde (ex: 01/01/2020)
3. Tipo de unidade (ex: MATRIZ, FILIAL)
4. Enquadramento de porte (ex: ME, EPP, DEMAIS, MEI)
5. Lista de sócios e administradores (nomes das pessoas)

Texto da página:
"""
${textoCompleto.substring(0, 8000)}
"""

Responda EXATAMENTE neste formato JSON:
{
  "situacao": "valor ou null",
  "ativaDesde": "valor ou null",
  "tipoUnidade": "valor ou null",
  "enquadramentoPorte": "valor ou null",
  "socios": ["nome1", "nome2"] ou []
}

Se não encontrar alguma informação, use null ou [] para socios.`;

      const result = await model.generateContent(prompt);
      const resposta = result.response.text().trim();

      console.log('  🤖 IA respondeu:', resposta.substring(0, 200));

      // Extrair JSON da resposta
      const jsonMatch = resposta.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('IA não retornou JSON válido');
      }

      const dados = JSON.parse(jsonMatch[0]);

      console.log('  ✅ Dados extraídos do CNPJBiz');
      console.log('     📋 Situação:', dados.situacao || 'N/A');
      console.log('     📅 Ativa desde:', dados.ativaDesde || 'N/A');
      console.log('     🏢 Tipo de unidade:', dados.tipoUnidade || 'N/A');
      console.log('     📊 Enquadramento de porte:', dados.enquadramentoPorte || 'N/A');
      console.log('     👥 Sócios/Administradores:', dados.socios && dados.socios.length > 0 ? dados.socios.join(', ') : 'N/A');

      return {
        cnpjUrl: url,
        situacao: dados.situacao !== 'null' && dados.situacao ? dados.situacao : undefined,
        ativaDesde: dados.ativaDesde !== 'null' && dados.ativaDesde ? dados.ativaDesde : undefined,
        tipoUnidade: dados.tipoUnidade !== 'null' && dados.tipoUnidade ? dados.tipoUnidade : undefined,
        enquadramentoPorte: dados.enquadramentoPorte !== 'null' && dados.enquadramentoPorte ? dados.enquadramentoPorte : undefined,
        sociosAdministradores: dados.socios && dados.socios.length > 0 ? dados.socios : []
      };
    } catch (error: any) {
      console.error('  ❌ Erro ao extrair dados CNPJBiz:', error.message);
      return { cnpjUrl: url };
    }
  }

  private async irParaProximaPaginaGoogle(page: Page): Promise<boolean> {
    console.log('');
    console.log('⏭️  Tentando ir para próxima página do Google...');

    try {
      const temProximaPagina = await page.evaluate(() => {
        const botaoProximo = document.querySelector('a#pnnext');
        return botaoProximo !== null;
      });

      if (!temProximaPagina) {
        console.log('  ⚠️  Botão "Próxima" não encontrado');
        return false;
      }

      await page.click('a#pnnext');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });

      console.log('  ✅ Próxima página carregada');
      return true;

    } catch (error: any) {
      console.error('  ❌ Erro ao ir para próxima página:', error.message);
      return false;
    }
  }
}
