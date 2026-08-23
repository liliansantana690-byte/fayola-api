require('dotenv').config();
const app = require('./src/app');
const iniciarJobExpiracao = require('./src/jobs/expirarAgendamentos');

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
    console.log(`Fayola API rodando na porta ${PORT}`);
    iniciarJobExpiracao();
});