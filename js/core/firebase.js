// ===== js/core/firebase.js =====
(function () {
'use strict';

/**
 * Ponte com o Firebase Realtime Database.
 *
 * Só este arquivo conhece o SDK: `db.js` fala com o banco por aqui, e as
 * views nunca falam. O SDK entra na versão *compat* (js/vendor/), que
 * publica o global `firebase` — o app não tem build step nem módulos.
 *
 * Sem Firebase Auth: o login é o do próprio app (usuarios/grupos no banco).
 * A consequência está nas regras do banco — leia o README antes de expor
 * a URL do projeto.
 */

var emit = NS.core.events.emit;
var EVENTOS = NS.core.events.EVENTOS;
var novoId = NS.core.id.novoId;

const CONFIG = {
    apiKey: 'AIzaSyAVvZNLf6Qys15qOVh5RgU8GekChKxqg9Q',
    authDomain: 'bd-propagandismo.firebaseapp.com',
    databaseURL: 'https://bd-propagandismo-default-rtdb.firebaseio.com',
    projectId: 'bd-propagandismo',
    storageBucket: 'bd-propagandismo.firebasestorage.app',
    messagingSenderId: '1050647698083',
    appId: '1:1050647698083:web:7927c0ad87da710120fd16'
};

/** Identifica esta aba nos locks de migração. Vive só em memória. */
const clienteId = novoId('cli');

/** Escrita recusada por falta de conexão — nunca vira gravação atrasada. */
class ErroSemConexao extends Error {
    constructor(mensagem) {
        super(mensagem || 'Sem conexão com o servidor.');
        this.name = 'ErroSemConexao';
    }
}

/** O SDK não carregou (pasta js/vendor incompleta ou bloqueada). */
class ErroSdkAusente extends Error {
    constructor() {
        super('O Firebase SDK não foi carregado.');
        this.name = 'ErroSdkAusente';
    }
}

let app = null;
let banco = null;
let conectadoAtual = false;

/**
 * Remove `undefined` recursivamente: `set`/`update` do RTDB lançam ao
 * encontrar um, e os formulários produzem campos indefinidos com facilidade.
 * Arrays viram arrays; objetos vazios são preservados como `{}`.
 */
function limparIndefinidos(valor) {
    if (Array.isArray(valor)) return valor.map(limparIndefinidos);
    if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
        const saida = {};
        for (const chave of Object.keys(valor)) {
            if (valor[chave] === undefined) continue;
            saida[chave] = limparIndefinidos(valor[chave]);
        }
        return saida;
    }
    return valor === undefined ? null : valor;
}

/**
 * Inicializa o SDK e começa a observar a conexão.
 * @throws {ErroSdkAusente} quando os scripts de js/vendor não carregaram.
 */
function iniciar() {
    if (app) return;

    if (!window.firebase || typeof window.firebase.database !== 'function') {
        throw new ErroSdkAusente();
    }

    app = window.firebase.initializeApp(CONFIG);
    banco = window.firebase.database();

    // `.info/connected` é local ao SDK: não gera tráfego e reflete o
    // estado real do socket, inclusive durante as reconexões automáticas.
    banco.ref('.info/connected').on('value', snap => {
        const novo = snap.val() === true;
        if (novo === conectadoAtual) return;
        conectadoAtual = novo;
        emit(EVENTOS.CONEXAO_ALTERADA, novo);
    });
}

function raiz() {
    return banco.ref('/');
}

function ref(caminho) {
    return banco.ref(caminho);
}

function conectado() {
    return conectadoAtual;
}

/** @returns {Function} desinscrição */
function aoMudarConexao(callback) {
    return NS.core.events.on(EVENTOS.CONEXAO_ALTERADA, callback);
}

/** `update` multi-path na raiz — atômico do lado do servidor. */
function atualizar(patch) {
    if (!conectadoAtual) return Promise.reject(new ErroSemConexao());
    return atualizarDireto(patch);
}

/**
 * Igual a `atualizar`, sem a checagem de conexão. Só o boot usa: ali a
 * leitura inicial já provou que há servidor, mas o evento de
 * `.info/connected` pode ainda não ter chegado.
 */
function atualizarDireto(patch) {
    return raiz().update(limparIndefinidos(patch));
}

function lerUmaVez(caminho) {
    return ref(caminho).once('value').then(snap => snap.val());
}

/**
 * Lock distribuído por compare-and-set: só um cliente ganha, mesmo com
 * várias abas subindo ao mesmo tempo. Usado pela migração de schema.
 *
 * O lock expira sozinho após `ttlMs` (cliente que morreu no meio) e é
 * removido por `onDisconnect` quando a aba fecha.
 *
 * @returns {Promise<boolean>} true se este cliente ganhou o lock
 */
function lock(caminho, ttlMs = 30000) {
    const alvo = ref(caminho);

    return alvo.transaction(atual => {
        const agora = Date.now();
        if (atual && agora - (atual.em || 0) < ttlMs) return undefined; // aborta
        return { por: clienteId, em: agora };
    }).then(resultado => {
        const ganhou = resultado.committed && resultado.snapshot.val()?.por === clienteId;
        if (ganhou) alvo.onDisconnect().remove();
        return ganhou;
    });
}

function liberarLock(caminho) {
    const alvo = ref(caminho);
    alvo.onDisconnect().cancel();
    return alvo.remove();
}

/** Espera um valor satisfazer `condicao`, ou rejeita após `timeoutMs`. */
function esperarValor(caminho, condicao, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const alvo = ref(caminho);

        const temporizador = setTimeout(() => {
            alvo.off('value', ouvinte);
            const erro = new Error('Tempo esgotado esperando o servidor.');
            erro.name = 'TimeoutErro';
            reject(erro);
        }, timeoutMs);

        function ouvinte(snap) {
            const valor = snap.val();
            if (!condicao(valor)) return;
            clearTimeout(temporizador);
            alvo.off('value', ouvinte);
            resolve(valor);
        }

        alvo.on('value', ouvinte, erro => {
            clearTimeout(temporizador);
            alvo.off('value', ouvinte);
            reject(erro);
        });
    });
}

NS.core = NS.core || {};
NS.core.firebase = {
    CONFIG,
    ErroSdkAusente,
    ErroSemConexao,
    aoMudarConexao,
    atualizar,
    atualizarDireto,
    clienteId,
    conectado,
    esperarValor,
    iniciar,
    lerUmaVez,
    limparIndefinidos,
    liberarLock,
    lock,
    raiz,
    ref,
    get SERVER_TIMESTAMP() {
        return window.firebase.database.ServerValue.TIMESTAMP;
    }
};
})();
