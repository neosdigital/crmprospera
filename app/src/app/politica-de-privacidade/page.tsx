import Link from "next/link";

export const metadata = {
  title: "Política de Privacidade | CRM Prospera",
  description: "Política de Privacidade do CRM Prospera.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 text-foreground">
      <div className="mb-8">
        <Link href="/" className="text-sm text-gold underline">
          ← Voltar
        </Link>
      </div>

      <h1 className="mb-2 text-2xl font-semibold">Política de Privacidade</h1>
      <p className="mb-8 text-sm text-text-secondary">Última atualização: 22 de setembro de 2026</p>

      <div className="space-y-6 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="mb-2 text-lg font-medium">1. Quem somos</h2>
          <p>
            O CRM Prospera é um sistema de gestão e distribuição automática de leads
            utilizado pela <strong>Próspera Relacionamentos &amp; Imóveis</strong>{" "}
            (&quot;Próspera&quot;, &quot;nós&quot;) para atender contatos gerados por campanhas de
            anúncios (Meta Ads / Facebook e Instagram) e pelo WhatsApp. Esta política
            explica quais dados coletamos, como usamos, com quem compartilhamos e quais
            direitos você tem sobre eles, em conformidade com a Lei Geral de Proteção de
            Dados (LGPD — Lei nº 13.709/2018).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">2. Quais dados coletamos</h2>
          <p>Coletamos dados fornecidos voluntariamente por você ao preencher um formulário de anúncio, entrar em contato pelo WhatsApp ou falar com um de nossos corretores, incluindo:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>Nome completo;</li>
            <li>Telefone / WhatsApp;</li>
            <li>E-mail;</li>
            <li>Respostas fornecidas no formulário do anúncio (ex.: tipo de imóvel, faixa de investimento, interesse em financiamento);</li>
            <li>Conteúdo das conversas trocadas com nossos corretores pelo WhatsApp;</li>
            <li>Metadados do anúncio que originou o contato (campanha, conjunto de anúncios e anúncio específico).</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">3. Como usamos seus dados</h2>
          <p>Utilizamos os dados coletados exclusivamente para:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>Distribuir seu contato a um corretor disponível e dar andamento ao atendimento;</li>
            <li>Entrar em contato com você por telefone, WhatsApp ou e-mail sobre o interesse demonstrado;</li>
            <li>Acompanhar o andamento do atendimento e medir a qualidade do nosso processo de vendas;</li>
            <li>Cumprir obrigações legais ou regulatórias, quando aplicável.</li>
          </ul>
          <p className="mt-2">Não utilizamos seus dados para qualquer finalidade diferente da relação comercial que originou o contato.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">4. Com quem compartilhamos</h2>
          <p>Seus dados podem ser processados pelos seguintes terceiros, estritamente para viabilizar o funcionamento do sistema:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>Meta Platforms, Inc.</strong> (Facebook/Instagram Ads) — origem do lead, quando o contato vem de um anúncio;</li>
            <li><strong>Meta (WhatsApp Business Platform)</strong> — envio e recebimento de mensagens de WhatsApp;</li>
            <li>Provedores de infraestrutura que hospedam o sistema (banco de dados e servidor de aplicação).</li>
          </ul>
          <p className="mt-2">Não vendemos nem alugamos seus dados pessoais a terceiros para fins de marketing.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">5. Retenção e exclusão</h2>
          <p>
            Mantemos seus dados enquanto durar o relacionamento comercial e pelo prazo
            necessário para cumprir obrigações legais. Você pode solicitar a exclusão dos
            seus dados a qualquer momento pelo canal de contato abaixo, exceto quando
            houver obrigação legal de retenção.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">6. Segurança</h2>
          <p>
            Adotamos medidas técnicas e administrativas razoáveis para proteger seus
            dados contra acessos não autorizados, perda ou alteração indevida, incluindo
            controle de acesso por usuário e criptografia de credenciais sensíveis.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">7. Seus direitos (LGPD)</h2>
          <p>Você tem direito a, entre outros: confirmar a existência de tratamento, acessar seus dados, corrigir dados incompletos ou desatualizados, solicitar anonimização ou exclusão, e revogar o consentimento dado. Para exercer qualquer um desses direitos, use o contato abaixo.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">8. Contato</h2>
          <p>
            Em caso de dúvidas sobre esta política ou sobre o tratamento dos seus dados,
            entre em contato:{" "}
            <a href="mailto:contato@prosperaimoveis.com.br" className="text-gold underline">
              contato@prosperaimoveis.com.br
            </a>
            .
          </p>
          <p className="mt-2 text-xs text-text-secondary">
            (Substituir pelo e-mail/telefone de contato real da imobiliária antes de publicar.)
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">9. Alterações desta política</h2>
          <p>
            Esta política pode ser atualizada periodicamente. A data da última atualização
            está indicada no topo desta página.
          </p>
        </section>
      </div>
    </div>
  );
}
