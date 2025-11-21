import puppeteer, { Browser, Page, Protocol } from 'puppeteer';
import fs from 'fs';
import path from 'path';

export class InstagramAuth {
  private cookiesPath = path.join(__dirname, '../.instagram-cookies.json');
  private cookies: Protocol.Network.Cookie[] | null = null;

  constructor() {
    this.carregarCookies();
  }

  private carregarCookies(): void {
    if (fs.existsSync(this.cookiesPath)) {
      try {
        const data = fs.readFileSync(this.cookiesPath, 'utf-8');
        this.cookies = JSON.parse(data);
        console.log('🔐 Cookies do Instagram carregados');
      } catch (error) {
        console.error('⚠️  Erro ao carregar cookies:', error);
        this.cookies = null;
      }
    }
  }

  private salvarCookies(cookies: Protocol.Network.Cookie[]): void {
    try {
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
      this.cookies = cookies;
      console.log('💾 Cookies salvos com sucesso');
    } catch (error) {
      console.error('⚠️  Erro ao salvar cookies:', error);
    }
  }

  public estaLogado(): boolean {
    return this.cookies !== null && this.cookies.length > 0;
  }

  public async fazerLogin(usuario: string, senha: string): Promise<void> {
    console.log('');
    console.log('🌐 Abrindo navegador para login...');

    const browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();

    try {
      // Setar user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      console.log('📱 Acessando Instagram...');
      await page.goto('https://www.instagram.com/accounts/login/', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // Esperar a página carregar
      await page.waitForTimeout(3000);

      console.log('⌨️  Preenchendo credenciais...');

      // Esperar os campos aparecerem
      await page.waitForSelector('input[name="username"]', { timeout: 10000 });

      // Preencher usuário
      await page.type('input[name="username"]', usuario, { delay: 100 });

      // Preencher senha
      await page.type('input[name="password"]', senha, { delay: 100 });

      // Esperar um pouco
      await page.waitForTimeout(1000);

      console.log('🔑 Fazendo login...');

      // Clicar no botão de login
      await page.click('button[type="submit"]');

      // Esperar navegação ou mensagem de erro
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        page.waitForTimeout(15000)
      ]);

      // Esperar um pouco mais
      await page.waitForTimeout(3000);

      // Verificar se o login foi bem-sucedido
      const urlAtual = page.url();

      if (urlAtual.includes('/challenge/')) {
        throw new Error('Instagram solicitou verificação adicional. Complete manualmente e tente novamente.');
      }

      if (urlAtual.includes('/accounts/login/')) {
        // Verificar se tem mensagem de erro
        const temErro = await page.evaluate(() => {
          const erros = document.body.innerText;
          return erros.includes('senha incorreta') ||
                 erros.includes('incorrect') ||
                 erros.includes('wasn\'t') ||
                 erros.includes('não foi possível');
        });

        if (temErro) {
          throw new Error('Usuário ou senha incorretos');
        }
      }

      // Tentar clicar em "Não agora" se aparecer popup de notificações
      try {
        await page.waitForTimeout(2000);
        const botaoNaoAgora = await page.$('button:has-text("Agora não")');
        if (botaoNaoAgora) {
          await botaoNaoAgora.click();
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        // Ignorar se não encontrar
      }

      // Pegar cookies
      const cookies = await page.cookies();

      console.log(`✅ Login bem-sucedido! ${cookies.length} cookies salvos`);

      // Salvar cookies
      this.salvarCookies(cookies);

    } catch (error: any) {
      console.error('❌ Erro durante login:', error.message);
      throw error;
    } finally {
      await browser.close();
    }
  }

  public async aplicarCookies(page: Page): Promise<void> {
    if (this.cookies && this.cookies.length > 0) {
      await page.setCookie(...this.cookies);
      console.log('🍪 Cookies do Instagram aplicados');
    }
  }

  public getCookies(): Protocol.Network.Cookie[] | null {
    return this.cookies;
  }
}
