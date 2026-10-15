const express = require('express');
const cors = require('cors');
const app = express();

app.set('trust proxy', 1);

const origensPermitidas = [
    'http://localhost:3000',
    'https://fayola-frontend-hlfj.vercel.app',
    process.env.APP_FRONTEND_URL
].filter(Boolean);

// Rejeita mutações iniciadas por páginas de outras origens (proteção CSRF por Origin).
// Requisições sem Origin continuam permitidas para webhooks e integrações servidor-servidor.
app.use((req, res, next) => {
    const metodosSeguros = ['GET', 'HEAD', 'OPTIONS'];
    const origin = req.get('Origin');
    if (!metodosSeguros.includes(req.method) && origin && !origensPermitidas.includes(origin)) {
        return res.status(403).json({ erro: 'Origem não permitida' });
    }
    next();
});

app.use(cors({
    credentials: true,
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
