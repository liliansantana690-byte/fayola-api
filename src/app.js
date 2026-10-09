const express = require('express');
const cors = require('cors');
const app = express();

const origensPermitidas = [
    'http://localhost:3000',
    'https://fayola-frontend-hlfj.vercel.app',
    process.env.APP_FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        if (!origin || origensPermitidas.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Origem não permitida pelo CORS'));
        }
    }
}));
app.use(express.json());

const authRoutes = require('./routes/auth');
const agendamentosRoutes = require('./routes/agendamentos');
const servicosRoutes = require('./routes/servicos');
const profissionaisRoutes = require('./routes/profissionais');
const pagamentosRoutes = require('./routes/pagamentos');
const mercadoPagoRoutes = require('./routes/mercadoPago');
const pedidosTattooRoutes = require('./routes/pedidosTattoo');
const disponibilidadeRoutes = require('./routes/disponibilidade');

app.use('/api/auth', authRoutes);
app.use('/api/agendamentos', agendamentosRoutes);
app.use('/api/servicos', servicosRoutes);
app.use('/api/profissionais', profissionaisRoutes);
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api/mercadopago', mercadoPagoRoutes);
app.use('/api/pedidos-tattoo', pedidosTattooRoutes);
app.use('/api/disponibilidade', disponibilidadeRoutes);

module.exports = app;