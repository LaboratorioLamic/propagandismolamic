// ===== js/core/storage.js =====
(function () {
'use strict';

/**
 * Persistência em localStorage.
 *
 * Um blob JSON único sob `labruta.db`. O app é single-user com dezenas/centenas
 * de registros — particionar por coleção só criaria risco de inconsistência.
 *
 * O mecanismo de MIGRATIONS é o que destrava as Ondas 2 e 3: ao adicionar
 * `produtos`, `campanhas` ou novos campos, registra-se uma migration nova
 * e as bases existentes se atualizam sozinhas no próximo load.
 */

const CHAVE = 'labruta.db';
const CHAVE_CORROMPIDO = 'labruta.db.backup-corrompido';
const CHAVE_PRE_IMPORT = 'labruta.db.pre-import';

const VERSAO_ATUAL = 3;

/** IDs de fábrica para os objetivos padrão — usados pela migration v2 e pelas seeds. */
const OBJETIVOS_PADRAO = [
    { id: 'obj_fortalecer_relacionamento', nome: 'Fortalecer relacionamento' },
    { id: 'obj_consolidar_parceria', nome: 'Consolidar parceria' },
    { id: 'obj_prospectar_novo', nome: 'Prospectar novo' }
];

/**
 * Chaves de permissão conhecidas.
 *
 * Duplicadas de propósito aqui: `core` não pode depender de `domain`, e as
 * seeds de grupo precisam nascer junto com o banco. A lista rica (rótulos,
 * agrupamento por módulo) vive em `js/domain/permissoes.js`, que valida
 * contra esta — divergência aparece como permissão órfã, não em silêncio.
 */
const PERMISSOES_CONHECIDAS = [
    'agenda.ver', 'agenda.criar', 'agenda.concluir', 'agenda.reagendar', 'agenda.cancelar',
    'medicos.ver', 'medicos.criar', 'medicos.editar', 'medicos.excluir',
    'catalogos.gerenciar',
    'backup.exportar', 'backup.importar', 'backup.apagar',
    'usuarios.gerenciar'
];

const SEM_ACESSO_TOTAL = ['usuarios.gerenciar', 'backup.apagar'];

/** Grupos de fábrica. IDs fixos para que migration e banco novo coincidam. */
function gruposPadrao() {
    const basico = ['agenda.ver', 'medicos.ver'];
    return [
        { id: 'grp_basico', nome: 'USUÁRIO BÁSICO', permissoes: basico.slice(), padrao: false },
        {
            id: 'grp_propagandista',
            nome: 'PROPAGANDISTA',
            permissoes: basico.concat(['agenda.criar', 'agenda.concluir', 'agenda.reagendar', 'medicos.criar', 'medicos.editar']),
            padrao: true
        },
        {
            id: 'grp_supervisor',
            nome: 'SUPERVISOR',
            permissoes: PERMISSOES_CONHECIDAS.filter(p => !SEM_ACESSO_TOTAL.includes(p)),
            padrao: false
        },
        { id: 'grp_gerente', nome: 'GERENTE', permissoes: PERMISSOES_CONHECIDAS.slice(), padrao: false }
    ];
}

/** Estrutura de um banco recém-criado. */
function dbVazio() {
    return {
        schemaVersion: VERSAO_ATUAL,
        medicos: [],
        visitas: [],
        especialidades: [],
        objetivos: OBJETIVOS_PADRAO.map(o => ({ ...o })),
        usuarios: [],
        grupos: gruposPadrao(),
        config: { nomeUsuario: '', autocadastro: false, grupoPadraoId: 'grp_propagandista' },
        atualizadoEm: new Date().toISOString()
    };
}

/**
 * Cada chave transforma a versão N-1 em N.
 * Onda 2 acrescentará:
 *   3: db => { db.produtos = []; db.medicos.forEach(m => m.statusRelacionamento ??= 'ativo'); }
 */
const MIGRATIONS = {
    // v1 é a base — nada a migrar.

    /**
     * Introduz os catálogos de especialidade e objetivo.
     * Especialidades: cada valor de texto distinto já usado por algum
     * médico vira uma entrada do catálogo, e o médico passa a referenciar
     * o id. Objetivos: os 3 valores fixos anteriores viram catálogo
     * editável, e as visitas existentes trocam a chave fixa pelo id novo.
     */
    2(db) {
        const normalizeStr = s => (s || '').toString().trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');

        db.especialidades = [];
        const porNomeNormalizado = new Map();

        for (const medico of db.medicos || []) {
            const nome = (medico.especialidade || '').trim();
            if (!nome) { medico.especialidadeId = ''; continue; }

            const chave = normalizeStr(nome);
            let entrada = porNomeNormalizado.get(chave);
            if (!entrada) {
                entrada = { id: `esp_${db.especialidades.length + 1}_${Date.now().toString(36)}`, nome };
                db.especialidades.push(entrada);
                porNomeNormalizado.set(chave, entrada);
            }
            medico.especialidadeId = entrada.id;
        }

        db.objetivos = OBJETIVOS_PADRAO.map(o => ({ ...o }));
        const idsValidos = new Set(db.objetivos.map(o => o.id));
        const mapaLegado = {
            fortalecer_relacionamento: 'obj_fortalecer_relacionamento',
            consolidar_parceria: 'obj_consolidar_parceria',
            prospectar_novo: 'obj_prospectar_novo'
        };

        for (const visita of db.visitas || []) {
            if (mapaLegado[visita.objetivo]) visita.objetivo = mapaLegado[visita.objetivo];
            else if (!idsValidos.has(visita.objetivo)) visita.objetivo = visita.objetivo || '';
        }
    },

    /**
     * Introduz contas de usuário e grupos de permissão.
     *
     * Nenhum usuário é criado: a base fica sem administrador de propósito, e
     * o boot em `js/main.js` cai no fluxo de cadastro do primeiro ADM. Criar
     * um usuário aqui exigiria inventar uma senha padrão — pior dos mundos.
     */
    3(db) {
        db.usuarios = [];
        db.grupos = gruposPadrao();
        db.config = { ...db.config, autocadastro: false, grupoPadraoId: 'grp_propagandista' };
    }
};

/** Aplica migrations em cadeia até a versão atual. Devolve o db mutado. */
function migrar(db) {
    let versao = Number(db.schemaVersion) || 0;

    while (versao < VERSAO_ATUAL) {
        const proxima = versao + 1;
        const migration = MIGRATIONS[proxima];
        if (typeof migration === 'function') migration(db);
        versao = proxima;
    }

    db.schemaVersion = VERSAO_ATUAL;
    return db;
}

/** Garante que o objeto tem a forma esperada, mesmo vindo de um blob parcial. */
function normalizar(bruto) {
    const base = dbVazio();
    if (!bruto || typeof bruto !== 'object') return base;

    return {
        schemaVersion: Number(bruto.schemaVersion) || 1,
        medicos: Array.isArray(bruto.medicos) ? bruto.medicos : [],
        visitas: Array.isArray(bruto.visitas) ? bruto.visitas : [],
        especialidades: Array.isArray(bruto.especialidades) ? bruto.especialidades : [],
        objetivos: Array.isArray(bruto.objetivos) ? bruto.objetivos : [],
        usuarios: Array.isArray(bruto.usuarios) ? bruto.usuarios : [],
        grupos: Array.isArray(bruto.grupos) ? bruto.grupos : [],
        config: { ...base.config, ...(bruto.config || {}) },
        atualizadoEm: bruto.atualizadoEm || base.atualizadoEm
    };
}

/**
 * Lê o banco. Se o conteúdo estiver corrompido, preserva o bruto em
 * `labruta.db.backup-corrompido` antes de devolver um banco vazio —
 * nunca descarta dados em silêncio.
 */
function carregar() {
    let bruto;

    try {
        bruto = localStorage.getItem(CHAVE);
    } catch {
        // localStorage indisponível (modo privado restrito): opera em memória.
        return { db: dbVazio(), corrompido: false, semPersistencia: true };
    }

    if (!bruto) return { db: dbVazio(), corrompido: false };

    try {
        return { db: migrar(normalizar(JSON.parse(bruto))), corrompido: false };
    } catch {
        try {
            localStorage.setItem(CHAVE_CORROMPIDO, bruto);
        } catch { /* sem espaço para o backup: segue com o banco vazio */ }
        return { db: dbVazio(), corrompido: true };
    }
}

let timerGravacao = null;
let ouvinteQuota = null;

/** Registra quem deve ser avisado quando a gravação falhar. */
function aoFalharGravacao(callback) {
    ouvinteQuota = callback;
}

function gravar(db) {
    try {
        localStorage.setItem(CHAVE, JSON.stringify(db));
        return true;
    } catch (erro) {
        const semEspaco = erro && (erro.name === 'QuotaExceededError' || erro.code === 22);
        ouvinteQuota?.(semEspaco
            ? 'Armazenamento cheio. Exporte um backup e remova registros antigos.'
            : 'Não foi possível salvar os dados neste navegador.');
        return false;
    }
}

/** Grava com debounce — evita stringify a cada tecla em formulários. */
function salvar(db, { imediato = false } = {}) {
    db.atualizadoEm = new Date().toISOString();

    if (imediato) {
        clearTimeout(timerGravacao);
        timerGravacao = null;
        return gravar(db);
    }

    clearTimeout(timerGravacao);
    timerGravacao = setTimeout(() => {
        timerGravacao = null;
        gravar(db);
    }, 150);

    return true;
}

/** Guarda o estado atual antes de uma importação, permitindo desfazer. */
function salvarSnapshotPreImport(db) {
    try {
        localStorage.setItem(CHAVE_PRE_IMPORT, JSON.stringify(db));
        return true;
    } catch {
        return false;
    }
}

function lerSnapshotPreImport() {
    try {
        const bruto = localStorage.getItem(CHAVE_PRE_IMPORT);
        return bruto ? migrar(normalizar(JSON.parse(bruto))) : null;
    } catch {
        return null;
    }
}

NS.core = NS.core || {};
NS.core.storage = { CHAVE, CHAVE_CORROMPIDO, CHAVE_PRE_IMPORT, PERMISSOES_CONHECIDAS, VERSAO_ATUAL, aoFalharGravacao, carregar, dbVazio, gruposPadrao, lerSnapshotPreImport, migrar, salvar, salvarSnapshotPreImport };
})();
