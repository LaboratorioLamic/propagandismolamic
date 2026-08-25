// ===== js/main.js =====
(function () {
'use strict';

/**
 * Bootstrap: storage -> sessão -> (login | shell + navegação).
 *
 * A decisão de acesso acontece antes de montar o shell: sem sessão, nada do
 * app é renderizado — nem header, nem nav, nem rota. É aqui também que mora a
 * guarda de rota, porque `js/core/navegacao.js` não conhece permissão (a
 * camada `core` nunca depende de `domain`).
 */

var html = NS.core.dom.html;
var raw = NS.core.dom.raw;
var db = NS.core.db;
var aoFalharGravacao = NS.core.storage.aoFalharGravacao;
var sessao = NS.core.sessao;
var navegacao = NS.core.navegacao;
var permissoes = NS.domain.permissoes;
var usuario = NS.domain.usuario;
var iniciarShell = NS.ui.shell.iniciarShell;
var toast = NS.ui.toast;
var icone = NS.ui.icons.icone;
var viewLogin = NS.ui.views.login;
var viewAgenda = NS.ui.views.agenda.viewAgenda;
var viewMedicos = NS.ui.views.medicos.viewMedicos;
var viewConfig = NS.ui.views.config.viewConfig;
let appIniciado = false;

function renderSemAcesso(container) {
    container.innerHTML = html`
        <div class="sem-acesso">
            ${raw(icone('cadeado'))}
            <h1>Sem acesso a esta tela</h1>
            <p>
                Seu grupo de permissões não inclui esta área. Se você precisa dela,
                peça a um administrador para ajustar seu grupo em Ajustes › Usuários.
            </p>
        </div>
    `;
}

/**
 * Envolve uma view com a checagem de permissão. O usuário sem acesso vê a
 * tela de bloqueio — nunca o conteúdo, mesmo digitando a hash na barra.
 */
function protegida(view, chave) {
    return {
        render(container, params) {
            if (!permissoes.pode(chave)) {
                renderSemAcesso(container);
                return;
            }
            return view.render(container, params);
        },
        destroy() {
            view.destroy?.();
        }
    };
}

/** Primeira rota permitida — evita cair numa tela bloqueada logo ao entrar. */
function rotaPadrao() {
    if (permissoes.pode('agenda.ver')) return '/agenda';
    if (permissoes.pode('medicos.ver')) return '/medicos';
    return '/config';
}

function iniciarApp() {
    const app = document.getElementById('app');
    document.body.classList.remove('sessao-fechada');
    app.innerHTML = '';

    const shell = iniciarShell({ aoSair: mostrarLogin });

    // registrar() sobrescreve por caminho, então reentrar depois de um logout
    // apenas atualiza as rotas — não duplica nada.
    navegacao.registrar('/agenda', protegida(viewAgenda, 'agenda.ver'));
    navegacao.registrar('/medicos', protegida(viewMedicos, 'medicos.ver'));
    navegacao.registrar('/config', viewConfig);

    const padrao = rotaPadrao();

    if (appIniciado) {
        // Segunda sessão na mesma aba: a navegação já está viva, só realinha.
        navegacao.navegar(padrao, {}, { substituir: true });
        shell.aoTrocarTela(padrao);
        return;
    }

    appIniciado = true;
    navegacao.iniciar(app, {
        padrao,
        onTrocar: caminho => shell.aoTrocarTela(caminho)
    });
}

function mostrarLogin() {
    const app = document.getElementById('app');

    // Depois de um logout a navegação continua ouvindo `hashchange`. Apontar
    // todas as rotas para a própria tela de login faz com que digitar
    // "#/medicos" na barra devolva o login, nunca a tela por baixo.
    if (appIniciado) {
        const telaLogin = { render: container => viewLogin.render(container, { aoEntrar: iniciarApp }) };
        for (const caminho of ['/agenda', '/medicos', '/config']) navegacao.registrar(caminho, telaLogin);
    }

    viewLogin.render(app, { aoEntrar: iniciarApp });
}

function iniciar() {
    const estado = db.iniciar();

    aoFalharGravacao(mensagem => toast.erro(mensagem, 8000));
    sessao.iniciar();

    if (estado.corrompido) {
        toast.erro('Os dados salvos estavam corrompidos. Uma cópia foi preservada e o app iniciou vazio.', 9000);
    }

    if (estado.semPersistencia) {
        toast.alerta('Este navegador bloqueou o armazenamento local. Os dados não serão salvos.', 9000);
    }

    // Sessão apontando para um usuário apagado ou desativado não vale nada.
    if (sessao.estaAutenticado() && !usuario.atual()) sessao.encerrar();

    if (usuario.precisaPrimeiroAdmin() || !sessao.estaAutenticado()) mostrarLogin();
    else iniciarApp();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
} else {
    iniciar();
}

NS.main = { iniciarApp, mostrarLogin };
})();
