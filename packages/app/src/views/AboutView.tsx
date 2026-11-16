export function AboutView() {
  return (
    <section className="about">
      <h2>À propos et limites</h2>

      <h3>Vos données</h3>
      <ul>
        <li>Tout reste sur votre appareil. Le site ne fait que livrer l'application : il ne reçoit ni ne conserve aucune donnée, et il n'y a pas de compte.</li>
        <li>L'application enregistre automatiquement dans ce navigateur. Cet enregistrement disparaît si vous effacez les données du site, changez de navigateur ou d'ordinateur, ou travaillez en navigation privée.</li>
        <li><strong>Enregistrez régulièrement un fichier</strong> (bouton « Enregistrer un fichier ») : c'est votre vraie sauvegarde, et le moyen de transmettre un espace à quelqu'un d'autre.</li>
        <li>Les fichiers ne sont ni chiffrés ni signés : quiconque les possède peut les lire et les modifier. À l'ouverture, l'application vérifie leur structure et signale ce qui est incohérent.</li>
      </ul>

      <h3>Navigateur</h3>
      <p>Un navigateur récent (Chrome, Edge, Firefox, Safari) est nécessaire : le calcul utilise WebAssembly et un fil d'exécution séparé. Les petits et moyens problèmes se calculent directement dans la page.</p>

      <h3>Le compagnon de calcul (facultatif)</h3>
      <ul>
        <li>Pour les gros problèmes. C'est un programme à lancer vous-même sur votre ordinateur : sous Windows, un seul fichier à télécharger (<code>compagnon.exe</code>) ; sur d'autres systèmes, une archive qui nécessite <strong>Node.js</strong>.</li>
        <li><strong>Laissez sa fenêtre ouverte</strong> pendant les calculs ; fermez-la quand vous avez fini.</li>
        <li>Au premier lancement, Windows affiche un avertissement (programme non signé : « Informations complémentaires », puis « Exécuter quand même »), et le navigateur peut demander l'autorisation d'accéder à un programme de votre réseau local : acceptez uniquement si vous venez de le lancer.</li>
        <li>Il n'écoute que votre ordinateur et n'accepte que ce site. Il n'est joignable depuis aucune autre machine.</li>
      </ul>

      <h3>Ce que le calcul fait, et ne fait pas</h3>
      <ul>
        <li>Les demandes sont des souhaits : le logiciel ne répond jamais « impossible », il propose le meilleur planning et explique ce qui manque. Les priorités se combinent en une note globale : une priorité haute l'emporte presque toujours, mais ce n'est pas un ordre strict.</li>
        <li>Le calcul est exact quand l'état « optimal » est affiché ; sinon c'est le meilleur planning trouvé dans le temps imparti.</li>
        <li>Un planning couvre un motif de 1 ou 2 semaines répété sur la période. Les fermetures et jours exceptionnels ne changent pas le motif : les séances touchées sont signalées comme annulées, sans rattrapage automatique.</li>
        <li>L'équité est réglable : elle évite qu'une demande reçoive toutes ses séances pendant qu'une autre de même priorité n'en reçoit aucune (la 1re séance d'une demande vaut plus que la dernière). Elle ne remplace jamais la priorité, et elle joue entre demandes, pas entre associations.</li>
      </ul>
    </section>
  );
}
