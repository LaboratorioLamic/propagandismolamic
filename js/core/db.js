// ===== js/core/db.js =====
(function () {
'use strict';

/**
 * CRUD genérico por coleção.
 *
 * Deliberadamente agnóstico ao domínio: nas Ondas 2 e 3, `produtos` e
 * `campanhas` funcionam sem uma linha de código novo aqui.
 */

var storage = NS.core.storage;
var novoId = NS.core.id.novoId;
var PREFIXOS = NS.core.id.PREFIXOS;
var emit = NS.core.events.emit;
var EVENTOS = NS.core.events.EVENTOS;
let db = storage.dbVazio();
let estadoInicial = { corrompido: false, semPersistencia: false };

/** Índice medicoId -> visitas, evita varredura O(n) por card na Agenda. */
let indiceVisitasPorMedico = new Map();

function reconstruirIndices() {
    indiceVisitasPorMedico = new Map();
    for (const visita of db.visitas) {
        const lista = indiceVisitasPorMedico.get(visita.medicoId);
        if (lista) lista.push(visita);
        else indiceVisitasPorMedico.set(visita.medicoId, [visita]);
    }
}

function iniciar() {
    const { db: carregado, corrompido, semPersistencia } = storage.carregar();
    db = carregado;
    estadoInicial = { corrompido: !!corrompido, semPersistencia: !!semPersistencia };
    reconstruirIndices();
    return estadoInicial;
}

/** Persiste e avisa as views. `imediato` pula o debounce (ações destrutivas). */
function persistir({ imediato = false, silencioso = false } = {}) {
    storage.salvar(db, { imediato });
    if (!silencioso) emit(EVENTOS.DADOS_ALTERADOS);
}

function estado() {
    return estadoInicial;
}

/* ------------------------------------------------------------------ *
 * Leitura
 * ------------------------------------------------------------------ */

function listar(colecao, filtro) {
    const itens = db[colecao] || [];
    return typeof filtro === 'function' ? itens.filter(filtro) : itens.slice();
}

function obter(colecao, id) {
    return (db[colecao] || []).find(item => item.id === id) || null;
}

function contar(colecao, filtro) {
    const itens = db[colecao] || [];
    return typeof filtro === 'function' ? itens.filter(filtro).length : itens.length;
}

function visitasDoMedico(medicoId) {
    return (indiceVisitasPorMedico.get(medicoId) || []).slice();
}

/* ------------------------------------------------------------------ *
 * Escrita
 * ------------------------------------------------------------------ */

function criar(colecao, dados, opcoes) {
    if (!db[colecao]) db[colecao] = [];

    const item = {
        ...dados,
        id: dados.id || novoId(PREFIXOS[colecao] || 'reg'),
        criadoEm: dados.criadoEm || new Date().toISOString()
    };

    db[colecao].push(item);
    reconstruirIndices();
    persistir(opcoes);
    return item;
}

function atualizar(colecao, id, patch, opcoes) {
    const item = obter(colecao, id);
    if (!item) return null;

    Object.assign(item, patch, { atualizadoEm: new Date().toISOString() });
    reconstruirIndices();
    persistir(opcoes);
    return item;
}

function remover(colecao, id, opcoes) {
    const lista = db[colecao] || [];
    const indice = lista.findIndex(item => item.id === id);
    if (indice === -1) return false;

    lista.splice(indice, 1);
    reconstruirIndices();
    persistir({ imediato: true, ...opcoes });
    return true;
}

/**
 * Executa várias mutações e grava uma única vez.
 * Usado pelo reagendamento, que precisa ser atômico.
 */
function transacao(fn, opcoes) {
    const resultado = fn(db);
    reconstruirIndices();
    persistir({ imediato: true, ...opcoes });
    return resultado;
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

function lerConfig() {
    return { ...db.config };
}

function gravarConfig(patch) {
    db.config = { ...db.config, ...patch };
    persistir({ imediato: true, silencioso: true });
    emit(EVENTOS.CONFIG_ALTERADA, lerConfig());
    return lerConfig();
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

/** Cópia profunda para exportação — o chamador não pode mutar o banco vivo. */
function exportarDados() {
    return JSON.parse(JSON.stringify({
        medicos: db.medicos,
        visitas: db.visitas,
        especialidades: db.especialidades,
        objetivos: db.objetivos,
        usuarios: db.usuarios,
        grupos: db.grupos,
        config: db.config
    }));
}

/**
 * Substitui todo o conteúdo. Snapshot de desfazer é responsabilidade do backup.js.
 *
 * `usuarios` e `grupos` só são trocados quando vêm no payload: um backup antigo
 * (ou os dados de teste) não pode apagar as contas e trancar o usuário fora do
 * próprio app.
 */
function substituirTudo(dados) {
    const vazio = storage.dbVazio();
    db.medicos = dados.medicos || [];
    db.visitas = dados.visitas || [];
    db.especialidades = dados.especialidades || [];
    db.objetivos = dados.objetivos || vazio.objetivos;
    if (Array.isArray(dados.usuarios)) db.usuarios = dados.usuarios;
    if (Array.isArray(dados.grupos)) db.grupos = dados.grupos;
    if (!db.grupos?.length) db.grupos = vazio.grupos;
    // A config atual entra na base da mesclagem: uma opção que o payload não
    // traz (autocadastro, grupo padrão) é preservada em vez de voltar ao
    // padrão de fábrica sem ninguém pedir.
    db.config = { ...vazio.config, ...db.config, ...(dados.config || {}) };
    db.schemaVersion = storage.VERSAO_ATUAL;
    reconstruirIndices();
    persistir({ imediato: true });
    emit(EVENTOS.CONFIG_ALTERADA, lerConfig());
}

/** Referência viva — só para snapshot pré-importação. */
function bancoBruto() {
    return db;
}

NS.core = NS.core || {};
NS.core.db = { atualizar, bancoBruto, contar, criar, estado, exportarDados, gravarConfig, iniciar, lerConfig, listar, obter, remover, substituirTudo, transacao, visitasDoMedico };
})();
