import puppeteer, { Browser, Page, Protocol } from 'puppeteer';
import fs from 'fs';
import path from 'path';

export class EconodataAuth {
  private cookiesPath = path.join(__dirname, '../.econodata-cookies.json');
  private cookies: Protocol.Network.Cookie[] | null = null;

  constructor() {
    this.carregarCookies();
  }

  private carregarCookies(): void {
    if (fs.existsSync(this.cookiesPath)) {
      try {
        const data = fs.readFileSync(this.cookiesPath, 'utf-8');
        this.cookies = JSON.parse(data);
        console.log('🔐 Cookies do Econodata carregados');
      } catch (error) {
        console.error('⚠️  Erro ao carregar cookies do Econodata:', error);
        this.cookies = null;
      }
    }
  }

  private salvarCookies(cookies: Protocol.Network.Cookie[]): void {
    try {
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
      this.cookies = cookies;
      console.log('💾 Cookies do Econodata salvos com sucesso');
    } catch (error) {
      console.error('⚠️  Erro ao salvar cookies do Econodata:', error);
    }
  }

  public estaLogado(): boolean {
    return this.cookies !== null && this.cookies.length > 0;
  }

  public async fazerLoginManual(): Promise<void> {
    console.log('');
    console.log('🌐 Abrindo navegador para login manual no Econodata...');

    const browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ],
      defaultViewport: null
    });

    try {
      const page = await browser.newPage();

      // Setar user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      console.log('📊 Acessando Econodata...');
      // Abrir página de uma empresa para ter acesso ao botão de login normal
      await page.goto('https://www.econodata.com.br/consulta-empresa/00000000000191-banco-do-brasil-sa', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      console.log('');
      console.log('👤 Clique em "Entrar" no canto superior direito e faça login.');
      console.log('⏳ Aguardando você fazer login...');
      console.log('💡 Quando o login for detectado, os cookies serão salvos automaticamente.');
      console.log('');

      // Monitorar a URL e cookies até detectar que o login foi feito
      let loginDetectado = false;
      const intervalo = setInterval(async () => {
        try {
          const url = page.url();
          const cookies = await page.cookies();

          // Verificar se há cookies de sessão do Econodata
          const temCookiesSessao = cookies.some(c =>
            c.name.includes('session') ||
            c.name.includes('auth') ||
            c.name.includes('token') ||
            c.name.includes('jwt') ||
            c.name.includes('access') ||
            c.name.toLowerCase().includes('user')
          );

          // Se não está na página de login/signin e tem cookies suficientes
          const estaNaPaginaLogin = url.includes('/login') || url.includes('/signin') || url.includes('/auth');

          if (!estaNaPaginaLogin && cookies.length > 5) {
            loginDetectado = true;
            clearInterval(intervalo);

            console.log(`✅ Login no Econodata detectado! ${cookies.length} cookies salvos`);
            this.salvarCookies(cookies);

            // Fechar navegador após um pequeno delay
            setTimeout(async () => {
              await browser.close();
            }, 2000);
          }
        } catch (e) {
          // Se der erro (página fechada), apenas limpar o intervalo
          clearInterval(intervalo);
        }
      }, 1000);

      // Esperar o navegador ser fechado (seja automaticamente ou pelo usuário)
      await new Promise<void>((resolve) => {
        browser.on('disconnected', () => {
          clearInterval(intervalo);
          resolve();
        });
      });

      if (!loginDetectado) {
        throw new Error('Navegador foi fechado antes de completar o login no Econodata.');
      }

    } catch (error: any) {
      // Se o navegador foi fechado antes de completar
      if (error.message.includes('Target closed') || error.message.includes('Session closed')) {
        console.log('');
        console.log('⚠️  Navegador foi fechado. Tentando salvar cookies...');

        // Não fazer nada, já foi tratado acima
      } else {
        console.error('❌ Erro durante login no Econodata:', error.message);
        throw error;
      }
    } finally {
      try {
        if (browser.isConnected()) {
          await browser.close();
        }
      } catch (e) {
        // Ignorar erros ao fechar
      }
    }
  }

  public async aplicarCookies(page: Page): Promise<void> {
    if (this.cookies && this.cookies.length > 0) {
      await page.setCookie(...this.cookies);
      console.log('🍪 Cookies do Econodata aplicados');
    }
  }

  public getCookies(): Protocol.Network.Cookie[] | null {
    return this.cookies;
  }
}
