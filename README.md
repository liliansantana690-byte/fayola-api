# 💈 Fayola API

Sistema de agendamento online para salões de beleza e barbearias, com notificação automática via WhatsApp.

## 🚀 Funcionalidades

- Cadastro e login de estabelecimentos com JWT
- Cadastro de serviços e profissionais
- Agendamento online pelo cliente (sem login)
- Notificação automática via WhatsApp na confirmação do agendamento
- Lembrete automático 24h antes do agendamento
- Painel de agendamentos do dia
- Cancelamento de agendamentos

## 🛠️ Tecnologias

- Node.js + Express
- PostgreSQL
- JWT (autenticação)
- Bcrypt (criptografia de senha)
- Twilio (WhatsApp)
- node-cron

## ⚙️ Como configurar

1. Clone o repositório
2. Instale as dependências:
```bash
   npm install
```
3. Crie o arquivo `.env` baseado no `.env.example`
4. Crie o banco de dados PostgreSQL e execute o schema
5. Rode o servidor:
```bash
   node index.js
```

## 🔐 Variáveis de ambiente

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fayola
DB_USER=postgres
DB_PASSWORD=

JWT_SECRET=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

PORT=3002
```

## 📱 Endpoints principais

- `POST /api/auth/cadastro` — cadastro do estabelecimento
- `POST /api/auth/login` — login
- `POST /api/servicos` — criar serviço (autenticado)
- `POST /api/profissionais` — criar profissional (autenticado)
- `POST /api/agendamentos` — criar agendamento (público)
- `GET /api/agendamentos/hoje` — agendamentos do dia (autenticado)

## 👩‍💻 Autora

Lilian Santana — Estudante de Engenharia de Software
GitHub: github.com/liliansantana690-byte