// ===== js/domain/medico.js =====
(function () {
'use strict';

/**
 * Domínio: Médico.
 *
 * Um médico tem UM endereço — não existe entidade Clínica na Onda 1.
 * Na Onda 2 entra `statusRelacionamento` via migration.
 */

var db = NS.core.db;
var enderecoVazio = NS.domain.enderecoUtils.enderecoVazio;
var formatarCep = NS.domain.enderecoUtils.formatarCep;
var normalizarEstado = NS.domain.enderecoUtils.normalizarEstado;
var normalizeStr = NS.domain.enderecoUtils.normalizeStr;
var apenasDigitos = NS.domain.telefone.apenasDigitos;
var ehTelefoneValido = NS.domain.telefone.ehTelefoneValido;
var ehCelular = NS.domain.telefone.ehCelular;
var formatarTelefone = NS.domain.telefone.formatarTelefone;
const COLECAO = 'medicos';

function medicoVazio() {
    return {
        nome: '',
        crm: '',
        especialidadeId: '',
        telefone: '',
        whatsapp: '',
        endereco: enderecoVazio(),
        referencia: '',
        diasHorarios: ''
    };
}

/** Monta o objeto a partir dos dados crus do formulário. */
function montarDoFormulario(dados) {
    return {
        nome: (dados.nome || '').trim(),
        crm: (dados.crm || '').trim().toUpperCase(),
        especialidadeId: (dados.especialidadeId || '').trim(),
        telefone: formatarTelefone(dados.telefone),
        whatsapp: formatarTelefone(dados.whatsapp),
        endereco: {
            cep: formatarCep(dados.cep),
            rua: (dados.rua || '').trim(),
            numero: (dados.numero || '').trim(),
            bairro: (dados.bairro || '').trim(),
            cidade: (dados.cidade || '').trim(),
            estado: normalizarEstado(dados.estado)
        },
        referencia: (dados.referencia || '').trim(),
        diasHorarios: (dados.diasHorarios || '').trim()
    };
}

/** Erros bloqueiam o salvamento. Devolve { campo: mensagem }. */
function validar(medico) {
    const erros = {};

    if (!medico.nome) erros.nome = 'Informe o nome do médico.';
    else if (medico.nome.length < 3) erros.nome = 'Nome muito curto.';

    if (medico.telefone && !ehTelefoneValido(medico.telefone)) {
        erros.telefone = 'Telefone incompleto — use DDD + número.';
    }

    if (medico.whatsapp && !ehTelefoneValido(medico.whatsapp)) {
        erros.whatsapp = 'WhatsApp incompleto — use DDD + número.';
    }

    const cep = apenasDigitos(medico.endereco?.cep);
    if (cep && cep.length !== 8) erros.cep = 'CEP deve ter 8 dígitos.';

    if (medico.endereco?.estado && !normalizarEstado(medico.endereco.estado)) {
        erros.estado = 'UF inválida.';
    }

    return erros;
}

/**
 * Avisos não bloqueiam o salvamento — apenas sinalizam.
 * WhatsApp Business em fixo existe, então fixo no campo é suspeito, não errado.
 */
function avisos(medico) {
    const lista = {};

    if (medico.whatsapp && ehTelefoneValido(medico.whatsapp) && !ehCelular(medico.whatsapp)) {
        lista.whatsapp = 'Parece um telefone fixo — WhatsApp normalmente é celular.';
    }

    return lista;
}

/* ------------------------------------------------------------------ *
 * Consultas
 * ------------------------------------------------------------------ */

function listar() {
    return db.listar(COLECAO).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function obter(id) {
    return db.obter(COLECAO, id);
}

/** Busca por nome, especialidade, CRM ou bairro — tudo normalizado. */
function buscar(termo) {
    const alvo = normalizeStr(termo);
    if (!alvo) return listar();

    var nomeEspecialidade = NS.domain.especialidade.obter;
    return listar().filter(medico => {
        const campos = [
            medico.nome,
            nomeEspecialidade(medico.especialidadeId)?.nome,
            medico.crm,
            medico.endereco?.bairro,
            medico.endereco?.cidade
        ];
        return campos.some(campo => normalizeStr(campo).includes(alvo));
    });
}

function criar(dados) {
    return db.criar(COLECAO, dados);
}

function atualizar(id, dados) {
    return db.atualizar(COLECAO, id, dados);
}

function remover(id) {
    return db.remover(COLECAO, id);
}

NS.domain = NS.domain || {};
NS.domain.medico = { COLECAO, atualizar, avisos, buscar, criar, listar, medicoVazio, montarDoFormulario, obter, remover, validar };
})();
