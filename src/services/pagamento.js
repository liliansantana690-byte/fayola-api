const { MercadoPagoConfig, Payment } = require('mercadopago');
 
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const paymentClient = new Payment(client);
 
/**
 * Cria uma cobrança PIX para o sinal de um agendamento.
 * OBS: Mercado Pago exige um e-mail do pagador. Como o Fayola só coleta WhatsApp
 * do cliente, geramos um e-mail sintético (não precisa ser real para o PIX processar).
 * Se quiser recibos por e-mail de verdade, é preciso coletar o e-mail no formulário.
 */
async function criarPagamentoPix({ valor, descricao, agendamentoId, clienteWhatsapp }) {
    const emailPagador = `cliente${clienteWhatsapp}@fayola.app`;
 
    const resultado = await paymentClient.create({
        body: {
            transaction_amount: Number(valor.toFixed(2)),
            description: descricao,
            payment_method_id: 'pix',
            payer: { email: emailPagador },
            external_reference: String(agendamentoId),
            notification_url: `${process.env.APP_API_URL}/api/pagamentos/webhook`
        }
    });
 
    const dadosTransacao = resultado.point_of_interaction.transaction_data;
 
    return {
        mp_payment_id: resultado.id,
        status: resultado.status,
        qr_code: dadosTransacao.qr_code,
        qr_code_base64: dadosTransacao.qr_code_base64
    };
}
 
async function consultarPagamento(paymentId) {
    return paymentClient.get({ id: paymentId });
}
 
module.exports = { criarPagamentoPix, consultarPagamento };
 