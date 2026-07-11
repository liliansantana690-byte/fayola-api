const twilio = require('twilio');

const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

async function notificarAgendamento(agendamento) {
    const { cliente_nome, cliente_whatsapp, data_hora, servico, profissional } = agendamento;

    const data = new Date(data_hora).toLocaleDateString('pt-BR');
    const hora = new Date(data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const mensagemCliente = `✅ *Agendamento Confirmado - Fayola*\n\n` +
        `Olá, ${cliente_nome}!\n` +
        `Seu agendamento foi confirmado:\n\n` +
        `✂️ Serviço: ${servico}\n` +
        `👤 Profissional: ${profissional}\n` +
        `📅 Data: ${data}\n` +
        `🕐 Horário: ${hora}\n\n` +
        `Até lá! 😊`;

    await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:+55${cliente_whatsapp}`,
        body: mensagemCliente
    });
}

async function enviarLembrete(agendamento) {
    const { cliente_nome, cliente_whatsapp, data_hora, servico } = agendamento;

    const hora = new Date(data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const mensagem = `⏰ *Lembrete - Fayola*\n\n` +
        `Olá, ${cliente_nome}!\n` +
        `Você tem um agendamento amanhã:\n\n` +
        `✂️ Serviço: ${servico}\n` +
        `🕐 Horário: ${hora}\n\n` +
        `Te esperamos! 😊`;

    await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:+55${cliente_whatsapp}`,
        body: mensagem
    });
}

module.exports = { notificarAgendamento, enviarLembrete };