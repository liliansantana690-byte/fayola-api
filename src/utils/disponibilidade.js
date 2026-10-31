const TIME_ZONE = process.env.APP_TIMEZONE || 'America/Bahia';

function validarData(data) {
    if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
    const [ano, mes, dia] = data.split('-').map(Number);
    const dataUtc = new Date(Date.UTC(ano, mes - 1, dia));
    return dataUtc.getUTCFullYear() === ano && dataUtc.getUTCMonth() === mes - 1 && dataUtc.getUTCDate() === dia;
}

function normalizarDataHora(dataHora) {
    if (typeof dataHora !== 'string') return null;
    const match = dataHora.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match || !validarData(match[1])) return null;
    const hora = Number(match[2]);
    const minuto = Number(match[3]);
    const segundo = Number(match[4] || 0);
    if (hora > 23 || minuto > 59 || segundo !== 0) return null;
    return `${match[1]}T${match[2]}:${match[3]}`;
}

function minutosDaHora(hora) {
    const [h, m] = String(hora).slice(0, 5).split(':').map(Number);
    return h * 60 + m;
}

function adicionarMinutos(dataHora, quantidade) {
    const [data, hora] = dataHora.split('T');
    const [ano, mes, dia] = data.split('-').map(Number);
    const [h, m] = hora.slice(0, 5).split(':').map(Number);
    const resultado = new Date(Date.UTC(ano, mes - 1, dia, h, m + Number(quantidade)));
    return `${resultado.getUTCFullYear()}-${String(resultado.getUTCMonth() + 1).padStart(2, '0')}-${String(resultado.getUTCDate()).padStart(2, '0')}T${String(resultado.getUTCHours()).padStart(2, '0')}:${String(resultado.getUTCMinutes()).padStart(2, '0')}`;
}

function agoraLocal() {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).reduce(function(resultado, parte) {
        resultado[parte.type] = parte.value;
        return resultado;
    }, {});
    return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

function erroDisponibilidade(mensagem) {
    const erro = new Error(mensagem);
    erro.statusCode = 409;
    return erro;
}

async function buscarDisponibilidadeDia(db, profissionalId, data, opcoes) {
    const opts = opcoes || {};
    const bloqueio = await db.query(
        'SELECT id FROM dias_bloqueados WHERE profissional_id = $1 AND data = $2::date',
        [profissionalId, data]
    );
    if (bloqueio.rows.length) {
        return { aberto: false, motivo: 'Dia bloqueado pelo profissional', horario: null, horarios: [], ocupados: [] };
    }

    const horariosResult = await db.query(
        `SELECT hora_inicio, hora_fim FROM horarios_profissional
         WHERE profissional_id = $1 AND dia_semana = EXTRACT(DOW FROM $2::date)::int
         ORDER BY hora_inicio`,
        [profissionalId, data]
    );
    const horarios = horariosResult.rows.map(function(h) {
        return {
            hora_inicio: String(h.hora_inicio).slice(0, 5),
            hora_fim: String(h.hora_fim).slice(0, 5)
        };
    });
    if (!horarios.length) {
        return { aberto: false, motivo: 'Profissional não atende nesse dia da semana', horario: null, horarios: [], ocupados: [] };
    }

    const excluiPedidoAtual = opts.excluirPedidoTattooId ? 'AND p.id <> $3' : '';
    const valores = [profissionalId, data];
    if (opts.excluirPedidoTattooId) valores.push(opts.excluirPedidoTattooId);
    const ocupadosResult = await db.query(
        `SELECT ocupado.inicio, ocupado.duracao_minutos
         FROM (
             SELECT TO_CHAR(a.data_hora, 'YYYY-MM-DD"T"HH24:MI') AS inicio,
                    GREATEST(COALESCE(s.duracao_minutos, 60), 1)::int AS duracao_minutos
             FROM agendamentos a
             JOIN servicos s ON s.id = a.servico_id
             WHERE a.profissional_id = $1
               AND a.data_hora >= $2::date
               AND a.data_hora < $2::date + INTERVAL '1 day'
               AND (a.status = 'confirmado' OR (a.status = 'aguardando_pagamento' AND a.expira_em > NOW()))
             UNION ALL
             SELECT TO_CHAR(p.data_hora, 'YYYY-MM-DD"T"HH24:MI') AS inicio,
                    GREATEST(COALESCE(p.duracao_minutos, 120), 1)::int AS duracao_minutos
             FROM pedidos_tattoo p
             WHERE p.profissional_id = $1
               AND p.status = 'convertido_agendamento'
               AND p.data_hora >= $2::date
               AND p.data_hora < $2::date + INTERVAL '1 day'
               ${excluiPedidoAtual}
         ) AS ocupado
         ORDER BY ocupado.inicio`,
        valores
    );
    const ocupados = ocupadosResult.rows.map(function(item) {
        return {
            inicio: String(item.inicio).slice(0, 16),
            fim: adicionarMinutos(String(item.inicio).slice(0, 16), item.duracao_minutos)
        };
    });

    return { aberto: true, motivo: null, horario: horarios[0], horarios, ocupados };
}

async function validarHorarioDisponivel(db, profissionalId, dataHoraEntrada, duracaoMinutos, opcoes) {
    const dataHora = normalizarDataHora(dataHoraEntrada);
    if (!dataHora) {
        const erro = new Error('Data e horário inválidos. Escolha um horário válido.');
        erro.statusCode = 400;
        throw erro;
    }
    if (dataHora <= agoraLocal()) {
        throw erroDisponibilidade('Escolha uma data e horário futuros.');
    }

    const data = dataHora.slice(0, 10);
    const disponibilidade = await buscarDisponibilidadeDia(db, profissionalId, data, opcoes);
    if (!disponibilidade.aberto) throw erroDisponibilidade(disponibilidade.motivo);

    const duracao = Math.max(1, Number(duracaoMinutos) || 60);
    const inicioMinutos = minutosDaHora(dataHora.slice(11, 16));
    const fimMinutos = inicioMinutos + duracao;
    const estaNoExpediente = disponibilidade.horarios.some(function(h) {
        const inicioExpediente = minutosDaHora(h.hora_inicio);
        const fimExpediente = minutosDaHora(h.hora_fim);
        return inicioMinutos >= inicioExpediente && fimMinutos <= fimExpediente && (inicioMinutos - inicioExpediente) % 30 === 0;
    });
    if (!estaNoExpediente) {
        throw erroDisponibilidade('Esse horário está fora do expediente ou não comporta a duração do serviço. Escolha outro horário.');
    }

    const fimNovo = adicionarMinutos(dataHora, duracao);
    const temConflito = disponibilidade.ocupados.some(function(outro) {
        return dataHora < outro.fim && outro.inicio < fimNovo;
    });
    if (temConflito) {
        throw erroDisponibilidade('Esse horário acabou de ser ocupado. Escolha outro horário disponível.');
    }
    return dataHora;
}

module.exports = {
    validarData,
    normalizarDataHora,
    buscarDisponibilidadeDia,
    validarHorarioDisponivel
};