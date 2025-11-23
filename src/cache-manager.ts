import fs from 'fs';
import path from 'path';

export class CacheManager {
  private cacheFilePath: string;
  private usernames: Set<string>; // Histórico de todas processadas
  private usernamesParaPular: Set<string>; // Só as importadas explicitamente

  constructor(cacheFilePath: string = '.empresas-processadas.json') {
    this.cacheFilePath = path.join(process.cwd(), cacheFilePath);
    this.usernames = new Set();
    this.usernamesParaPular = new Set();
    this.carregar();
  }

  // Carregar cache do arquivo
  private carregar(): void {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const data = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const parsed = JSON.parse(data);

        if (parsed.usernames && Array.isArray(parsed.usernames)) {
          this.usernames = new Set(parsed.usernames);
          console.log(`📦 Cache carregado: ${this.usernames.size} usernames no histórico`);
        }

        // Carregar lista de pular se existir
        if (parsed.usernamesParaPular && Array.isArray(parsed.usernamesParaPular)) {
          this.usernamesParaPular = new Set(parsed.usernamesParaPular);
          console.log(`⏭️  ${this.usernamesParaPular.size} usernames para pular`);
        }
      } else {
        console.log('📦 Nenhum cache encontrado, iniciando vazio');
      }
    } catch (error: any) {
      console.error('⚠️  Erro ao carregar cache:', error.message);
      this.usernames = new Set();
      this.usernamesParaPular = new Set();
    }
  }

  // Salvar cache no arquivo
  salvar(): void {
    try {
      const data = {
        usernames: Array.from(this.usernames),
        usernamesParaPular: Array.from(this.usernamesParaPular),
        ultimaAtualizacao: new Date().toISOString(),
        total: this.usernames.size,
        totalParaPular: this.usernamesParaPular.size
      };

      fs.writeFileSync(this.cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`💾 Cache salvo: ${this.usernames.size} no histórico, ${this.usernamesParaPular.size} para pular`);
    } catch (error: any) {
      console.error('⚠️  Erro ao salvar cache:', error.message);
    }
  }

  // Adicionar username ao histórico (não pula automaticamente)
  adicionar(username: string): void {
    if (username && username.trim()) {
      this.usernames.add(username.toLowerCase().trim());
    }
  }

  // Verificar se username deve ser pulado (só os importados explicitamente)
  jaProcessado(username: string): boolean {
    if (!username || !username.trim()) return false;
    return this.usernamesParaPular.has(username.toLowerCase().trim());
  }

  // Importar usernames para PULAR (via input/documento)
  importar(usernames: string[]): number {
    const tamanhoAntes = this.usernamesParaPular.size;

    usernames.forEach(username => {
      if (username && username.trim()) {
        this.usernamesParaPular.add(username.toLowerCase().trim());
      }
    });

    const novos = this.usernamesParaPular.size - tamanhoAntes;
    console.log(`📥 Importados ${novos} novos usernames para pular`);
    this.salvar(); // Salvar após importar

    return novos;
  }

  // Obter total de usernames no histórico
  getTotal(): number {
    return this.usernames.size;
  }

  // Obter total de usernames para pular
  getTotalParaPular(): number {
    return this.usernamesParaPular.size;
  }

  // Limpar cache
  limpar(): void {
    this.usernames.clear();
    this.usernamesParaPular.clear();
    if (fs.existsSync(this.cacheFilePath)) {
      fs.unlinkSync(this.cacheFilePath);
    }
    console.log('🗑️  Cache limpo');
  }

  // Limpar apenas a lista de pular
  limparListaPular(): void {
    this.usernamesParaPular.clear();
    this.salvar();
    console.log('🗑️  Lista de pular limpa');
  }
}
