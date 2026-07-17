const axios = require('axios');

const ZAPI_URL = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`;

async function enviarWhatsApp(numero, mensagem) {
    try {
        await axios.post(`${ZAPI_URL}/send-text`, {
            phone: `55${numero}`,
            message: mensagem
        });
        console.log('Mensagem enviada para:', numero);
    } catch (err) {
        console.error('Erro ao enviar WhatsApp:', err.message);
    }
}

async function notificarAgendamento(agendamento) {
    const { cliente_nome, cliente_whatsapp, data_hora, servico, profissional } = agendamento;

    const data = new Date(data_hora).toLocaleDateString('pt-BR');
    const hora = new Date(data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const mensagem = `✅ *Agendamento Confirmado!*\n\n` +
        `Olá, ${cliente_nome}!\n\n` +
        `✂️ Serviço: ${servico}\n` +
        `👤 Profissional: ${profissional}\n` +
        `📅 Data: ${data}\n` +
        `🕐 Horário: ${hora}\n\n` +
        `Te esperamos! 😊\n\n` +
        `_Powered by Fayola_`;

    await enviarWhatsApp(cliente_whatsapp, mensagem);
}

async function enviarLembrete(agendamento) {
    const { cliente_nome, cliente_whatsapp, data_hora, servico } = agendamento;

    const hora = new Date(data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const mensagem = `⏰ *Lembrete de Agendamento*\n\n` +
        `Olá, ${cliente_nome}!\n\n` +
        `Você tem um agendamento amanhã:\n\n` +
        `✂️ Serviço: ${servico}\n` +
        `🕐 Horário: ${hora}\n\n` +
        `Te esperamos! 😊\n\n` +
        `_Powered by Fayola_`;

    await enviarWhatsApp(cliente_whatsapp, mensagem);
}

module.exports = { notificarAgendamento, enviarLembrete };