const express = require('express');
const cors = require('cors');
const { ORIGENS_PERMITIDAS } = require('./utils/sessao');
const app = express();

app.use(cors({
    origin: function(origin, callback) {
        if (!origin || ORIGENS_PERMITIDAS.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true
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