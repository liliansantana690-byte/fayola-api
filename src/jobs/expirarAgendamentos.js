const cron = require('node-cron');
const pool = require('../config/db');

function iniciarJobExpiracao() {
    // Roda a cada minuto: libera agendamentos que passaram do prazo sem pagar o sinal
    cron.schedule('* * * * *', async () => {
        try {
            const result = await pool.query(
                `UPDATE agendamentos
                 SET status = 'expirado', sinal_status = 'expirado'
                 WHERE status = 'aguardando_pagamento' AND expira_em < NOW()
                 RETURNING id`
            );
            if (result.rows.length > 0) {
                console.log(`${result.rows.length} agendamento(s) expirado(s) por falta de pagamento do sinal`);
            }
        } catch (err) {
            console.error('Erro ao expirar agendamentos:', err.message);
        }
    });
}

module.exports = iniciarJobExpiracao;