// ===== js/ui/views/medicoDetalhe.js =====
(function () {
'use strict';

/**
 * Detalhe do médico, em modal.
 * Único lugar onde o mapa carrega sozinho (um mapa por vez).
 */

var html = NS.core.dom.html;
var raw = NS.core.dom.raw;
var delegarAcoes = NS.core.dom.delegarAcoes;
var formatarData = NS.core.dom.formatarData;
var pluralizar = NS.core.dom.pluralizar;
var modal = NS.ui.modal;
var toast = NS.ui.toast;
var icone = NS.ui.icons.icone;
var botaoWhatsApp = NS.ui.components.card.botaoWhatsApp;
var avatar = NS.ui.components.card.avatar;
var itemHistorico = NS.ui.components.card.itemHistorico;
var criarMapa = NS.ui.components.mapa.criarMapa;
var limparMapas = NS.ui.components.mapa.limparMapas;
var formatarEndereco = NS.domain.enderecoUtils.formatarEndereco;
var urlTelefone = NS.domain.telefone.urlTelefone;
var medicos = NS.domain.medico;
var especialidades = NS.domain.especialidade;
var visitas = NS.domain.visita;
var abrirFormularioMedico = NS.ui.forms.medicoForm.abrirFormularioMedico;
var abrirFormularioVisita = NS.ui.forms.visitaForm.abrirFormularioVisita;
var abrirVisualizarVisita = NS.ui.forms.visitaAcoes.abrirVisualizarVisita;
var pode = NS.domain.permissoes.pode;
function linhaContato(rotulo, valor, acao) {
    if (!valor) return '';
    return html`
        <div class="detalhe__contato">
            <span>
                <span class="detalhe__rotulo">${rotulo}</span>
                <span class="detalhe__valor">${valor}</span>
            </span>
            ${raw(acao || '')}
        </div>
    `;
}

/**
 * @param {string} medicoId
 * @param {object} [callbacks]
 * @param {Function} [callbacks.aoAlterar] chamado quando algo muda
 */
function abrirDetalheMedico(medicoId, { aoAlterar } = {}) {
    const medico = medicos.obter(medicoId);
    if (!medico) {
        toast.erro('Médico não encontrado.');
        return;
    }

    const historico = visitas.doMedico(medicoId);
    const abertas = historico.filter(v => v.status === visitas.STATUS.AGENDADA);
    const enderecoTexto = formatarEndereco(medico.endereco);

    let overlayAtual = null;

    modal.abrir({
        titulo: medico.nome,
        subtitulo: [especialidades.obter(medico.especialidadeId)?.nome, medico.crm].filter(Boolean).join(' · '),
        corpo: html`
            <div class="detalhe">
                <div class="card__identidade">
                    ${raw(avatar(medico.nome))}
                    <div>
                        <div class="card__nome">${medico.nome}</div>
                        <div class="card__sub">
                            ${historico.length
                                ? pluralizar(historico.length, 'visita registrada', 'visitas registradas')
                                : 'Nenhuma visita ainda'}
                        </div>
                    </div>
                </div>

                ${raw(linhaContato('Consultório', medico.telefone,
                    medico.telefone ? html`<a class="btn btn--outline btn--sm" href="${urlTelefone(medico.telefone)}">${raw(icone('telefone'))} Ligar</a>` : ''))}

                ${raw(linhaContato('WhatsApp', medico.whatsapp,
                    botaoWhatsApp(medico.whatsapp, medico.nome, { comRotulo: true })))}

                ${raw(medico.diasHorarios ? html`
                    <div class="detalhe__grupo">
                        <span class="detalhe__rotulo">Dias e horários</span>
                        <span class="detalhe__valor">${medico.diasHorarios}</span>
                    </div>
                ` : '')}

                <div class="detalhe__grupo">
                    <span class="detalhe__rotulo">Endereço</span>
                    <span class="detalhe__valor">${enderecoTexto || 'Não informado'}</span>
                    ${raw(medico.referencia ? html`<span class="texto-sm texto-muted">${medico.referencia}</span>` : '')}
                    <div data-slot-mapa></div>
                </div>

                ${raw(historico.length ? html`
                    <div class="detalhe__grupo">
                        <span class="detalhe__rotulo">Histórico</span>
                        <div class="historico">
                            ${raw(historico.slice(0, 8).map(itemHistorico).join(''))}
                        </div>
                    </div>
                ` : '')}

                <div class="form__acoes">
                    ${raw(pode('medicos.editar') ? html`
                        <button type="button" class="btn btn--outline" data-acao="editar">
                            ${raw(icone('editar'))} Editar
                        </button>
                    ` : '')}
                    ${raw(pode('agenda.criar') ? html`
                        <button type="button" class="btn btn--primario" data-acao="agendar">
                            ${raw(icone('agendaAdicionar'))} Agendar visita
                        </button>
                    ` : '')}
                </div>

                ${raw(pode('medicos.excluir') ? html`
                    <button type="button" class="btn btn--perigo btn--bloco btn--sm" data-acao="excluir">
                        ${raw(icone('excluir'))} Excluir cadastro
                    </button>
                ` : '')}
            </div>
        `,

        aoMontar({ corpo, fechar, overlay }) {
            overlayAtual = overlay;

            // Auto-lazy: um único mapa nesta tela, sem risco de rajada.
            const slot = corpo.querySelector('[data-slot-mapa]');
            if (enderecoTexto) slot.appendChild(criarMapa(medico.endereco, { auto: true }));

            // Histórico é interativo: clicar num item abre a janela de visualização da visita.
            delegarAcoes(corpo, {
                abrirVisita: ({ id }) => {
                    if (id) abrirVisualizarVisita(id, { aoAlterar });
                }
            });

            // Os botões só existem se a permissão existe — daí o `?.`.
            corpo.querySelector('[data-acao="editar"]')?.addEventListener('click', async () => {
                const atualizado = await abrirFormularioMedico(medico);
                if (atualizado) {
                    fechar();
                    aoAlterar?.();
                    abrirDetalheMedico(medicoId, { aoAlterar });
                }
            });

            corpo.querySelector('[data-acao="agendar"]')?.addEventListener('click', async () => {
                const criada = await abrirFormularioVisita({ medicoId });
                if (criada) {
                    fechar();
                    aoAlterar?.();
                }
            });

            corpo.querySelector('[data-acao="excluir"]')?.addEventListener('click', async () => {
                // Bloqueia quando há visitas agendadas — evita perda de histórico.
                if (abertas.length) {
                    await modal.confirmar({
                        titulo: 'Não é possível excluir',
                        mensagem: `${medico.nome} tem ${pluralizar(abertas.length, 'visita agendada', 'visitas agendadas')}.`,
                        detalhe: abertas
                            .map(v => `<div>• ${formatarData(v.data)}${v.horario ? ` às ${v.horario}` : ''}</div>`)
                            .join(''),
                        confirmarTexto: 'Entendi',
                        cancelarTexto: 'Fechar'
                    });
                    return;
                }

                const confirmado = await modal.confirmar({
                    titulo: 'Excluir médico',
                    mensagem: `Excluir ${medico.nome} da sua carteira?`,
                    detalhe: historico.length
                        ? `Também serão removidas ${pluralizar(historico.length, 'visita do histórico', 'visitas do histórico')}.`
                        : '',
                    confirmarTexto: 'Excluir',
                    perigo: true
                });

                if (!confirmado) return;

                historico.forEach(v => visitas.remover(v.id));
                medicos.remover(medicoId);

                toast.sucesso('Médico excluído.');
                fechar();
                aoAlterar?.();
            });
        },

        aoFechar() {
            // Sem isso o IntersectionObserver do mapa vazaria.
            if (overlayAtual) limparMapas(overlayAtual);
        }
    });
}

NS.ui = NS.ui || {};
NS.ui.views = NS.ui.views || {};
NS.ui.views.medicoDetalhe = { abrirDetalheMedico };
})();
