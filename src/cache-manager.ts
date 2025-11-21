import fs from 'fs';
import path from 'path';

interface CacheData {
  usernames: Set<string>;
  ultimaAtualizacao: string;
  total: number;
}

export class CacheManager {
  private cacheFilePath: string;
  private usernames: Set<string>;

  constructor(cacheFilePath: string = '.empresas-processadas.json') {
    this.cacheFilePath = path.join(process.cwd(), cacheFilePath);
    this.usernames = new Set();
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
          console.log(`📦 Cache carregado: ${this.usernames.size} usernames`);
        }
      } else {
        console.log('📦 Nenhum cache encontrado, iniciando vazio');
      }
    } catch (error: any) {
      console.error('⚠️  Erro ao carregar cache:', error.message);
      this.usernames = new Set();
    }
  }

  // Salvar cache no arquivo
  salvar(): void {
    try {
      const data = {
        usernames: Array.from(this.usernames),
        ultimaAtualizacao: new Date().toISOString(),
        total: this.usernames.size
      };

      fs.writeFileSync(this.cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`💾 Cache salvo: ${this.usernames.size} usernames`);
    } catch (error: any) {
      console.error('⚠️  Erro ao salvar cache:', error.message);
    }
  }

  // Adicionar username ao cache
  adicionar(username: string): void {
    if (username && username.trim()) {
      this.usernames.add(username.toLowerCase().trim());
    }
  }

  // Verificar se username já foi processado
  jaProcessado(username: string): boolean {
    if (!username || !username.trim()) return false;
    return this.usernames.has(username.toLowerCase().trim());
  }

  // Importar usernames de um array (para CSVs/JSONs)
  importar(usernames: string[]): number {
    const tamanhoAntes = this.usernames.size;

    usernames.forEach(username => {
      if (username && username.trim()) {
        this.usernames.add(username.toLowerCase().trim());
      }
    });

    const novos = this.usernames.size - tamanhoAntes;
    console.log(`📥 Importados ${novos} novos usernames`);

    return novos;
  }

  // Obter total de usernames
  getTotal(): number {
    return this.usernames.size;
  }

  // Limpar cache
  limpar(): void {
    this.usernames.clear();
    if (fs.existsSync(this.cacheFilePath)) {
      fs.unlinkSync(this.cacheFilePath);
    }
    console.log('🗑️  Cache limpo');
  }
}
