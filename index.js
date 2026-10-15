require('dotenv').config();
const app = require('./src/app');
const pool = require('./src/config/db');
const iniciarJobExpiracao = require('./src/jobs/expirarAgendamentos');

const PORT = process.env.PORT || 3002;

async function iniciarServidor() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedidos_tattoo_anamnese (
                pedido_id INTEGER PRIMARY KEY REFERENCES pedidos_tattoo(id) ON DELETE CASCADE,
                respostas JSONB NOT NULL,
                consentimento BOOLEAN NOT NULL CHECK (consentimento = true),
                consentimento_versao VARCHAR(50) NOT NULL,
                consentimento_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        app.listen(PORT, () => {
            console.log(`Fayola API rodando na porta ${PORT}`);
            iniciarJobExpiracao();
        });
    } catch (err) {
        console.error('Erro ao preparar o banco para iniciar a API:', err.message);
        process.exit(1);
    }
}

iniciarServidor();
