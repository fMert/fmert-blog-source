---
title: Queyntisen nun estas alternativo al Obsidian
date: 2026-06-18 01:20:00 +0300
categories: [Projekto]
tags: [queyntisen, markdown, obsidian, terminalo, artefarita-inteligenteco, python, libera-programaro]
---

Antaŭ ĉirkaŭ kvar monatoj mi verkis tre simplan terminalan redaktilon en Python: **Queyntisen**.

Tiam la ideo estis eta. Ĝi estis eksperimenta redaktilo funkcianta en la terminalo, kapabla malfermi Markdown-dosierojn, kun iom da Vim-sento kaj simpla AI-panelo dekstre. Ĝi funkciis, sed sincere aspektis pli kiel semajnfina projekto. Poste mi longe ne tuŝis ĝin.

Lastatempe mi remalfermis Queyntisen kaj, kun helpo de AI, multe progresigis la projekton. Ĝi ne plu estas nur simpla terminala redaktilo: ĝi iĝas AI-helpata, terminala laborspaco vere uzebla por Markdown-notoj.

![Ekrankopio de Queyntisen](https://raw.githubusercontent.com/fMert/Queyntisen/main/screenshot.png)

## Terminala alternativo al Obsidian

Obsidian estas tre potenca programo. Ĝia Markdown-bazo, konservado de notoj kiel simplaj dosieroj kaj aldonaĵa ekosistemo faras ĝin nemalhavebla por multaj. Sed por mi ĉiam estis malgranda problemo: Obsidian estas labortabla programo bazita sur Electron.

Mi pasigas grandan parton de la tago en la terminalo. Tie mi programas, notas kaj redaktas dosierojn. Ŝanĝi al aparta grafika programo por redakti noton ĉiam ŝajnis tro multe.

Tie Queyntisen utilas.

Queyntisen prenas tion, kion mi ŝatas en Obsidian — laboron kun Markdown-dosieroj — kaj portas ĝin al la terminalo. Sed ĝi ne estas nur simpla tekstredaktilo. Defaŭlte ĝi malfermas Markdown-dosieron en bela antaŭrigardo. Per `Ctrl-E` oni povas iam ajn ŝanĝi al redaktado de la kruda Markdown-fonto.

Do dum legado vi havas puran, ordigitan noton, kaj dum verkado rektan kontrolon de la fonto.

## Kial ĝi pli taŭgas por mi?

Mi ne asertas, ke ĝi estas absolute "pli bona" por ĉiuj. Obsidian havas grandegan ekosistemon. Sed por mia laborstilo Queyntisen pli bone kongruas.

Unue, ĝi funkcias en la terminalo. Sen Electron, sen peza interfaco, sen serĉado de fenestro per muso. Vi povas malfermi, legi, redakti kaj konservi noton sen forlasi la klavaron.

Due, AI ne estas poste aldonita aldonaĵo. Ĝi estas kerna parto de Queyntisen. Por uzi AI en Obsidian oni kutime serĉas aldonaĵon, ĝustigas agordojn, malfermas panelojn kaj foje uzas eksterajn ilojn. En Queyntisen AI-panelo jam troviĝas dekstre.

Per `Ctrl-W` vi ŝanĝas al la AI-panelo, skribas peton kaj premas Enter. Queyntisen sendas la tutan aktualan Markdown-dosieron al la modelo kiel kuntekston. La modelo redonas reorganizitan noton, kaj la rezulto estas aplikata rekte al la redaktila bufro.

Tiu fluo estas natura por ordigi noton, aldoni titolojn, krei taskoliston, formati kunvenajn notojn aŭ fari tekston pli mallonga kaj klara.

## Kiel funkcias la AI-integriĝo?

La AI-parto de Queyntisen estas speciale desegnita por Markdown-verkado. La asistanto en la dekstra panelo vidas la tutan malfermitan noton. Tio gravas, ĉar la modelo ricevas la kuntekston de la tuta dokumento, ne nur kelkajn elektitajn liniojn.

Ekzemple vi povas skribi:

```text
Transformu ĉi tiun noton en pli ordigitan projektplanon.
```

Aŭ:

```text
Korektu la titolojn, forigu ripetojn kaj faru taskoliston el la agopunktoj.
```

La modelo legas la tutan dokumenton kaj produktas pli bone organizitan Markdown-dosieron. Queyntisen aplikas tiun eliron al la nuna bufro.

La bela afero estas, ke la AI-peto funkcias fone. La redaktilo ne tute frostiĝas. Oni nun povas ankaŭ agordi provizantojn interne de la redaktilo.

Per la komando `:setup` vi elektas provizanton. Subtenataj estas OpenAI, Anthropic, DeepSeek, OpenRouter, LM Studio, Ollama kaj aliaj OpenAI-kongruaj servoj. Por loka modelo vi povas uzi LM Studio aŭ Ollama; por reta modelo vi agordas ĝin en la sama menuo.

Per `:model` vi povas esplori kaj elekti disponeblajn modelojn. La elektoj estas konservataj en `~/.config/queyntisen/config.json`.

## Markdown-antaŭrigardo nun vere utilas

La unua versio de Queyntisen estis pli proksima al redaktado de kruda teksto. Nun la Markdown-antaŭrigardo estas multe pli kapabla.

Ĝi subtenas interalie:

- titolojn,
- alineojn,
- punktolistojn,
- numeritajn listojn,
- taskolistojn,
- citaĵojn,
- horizontalajn liniojn,
- kodblokojn kun bariloj,
- enlinian kodon,
- grasan, kursivan kaj trastrekitan tekston,
- ligilojn,
- bildojn,
- aŭtomatajn ligilojn,
- tabelojn.

Tiel Queyntisen estas pli ol ilo por malfermi kaj redakti dosierojn. Legi notojn en la terminalo ankaŭ fariĝis agrabla.

## Reĝima redaktado kaj komandoj

Queyntisen plu uzas reĝimojn inspiritajn de Vim. En fonta reĝimo estas normala kaj eniga reĝimoj. La konataj movoj funkcias: `hjkl` por navigi, `dd` por forigi linion, `yy` por kopii, `p` por alglui kaj `u` por malfari.

La bazaj komandoj estas:

```text
:w
:q
:wq
:x
:setup
:model
```

En la komandlinio `:`, `Tab` ankaŭ kompletigas komandojn. Eta detalo, sed tre agrabla en terminala redaktilo.

## Reveni kun AI post kvar monatoj

La plej interesa parto de la projekto por mi estas ne nur Queyntisen mem, sed ankaŭ ĝia disvolvado.

Antaŭ kvar monatoj mi verkis ĝin kiel tre bazan Python-eksperimenton kaj poste flankenmetis ĝin. Kiam mi lastatempe remalfermis ĝin, mi ekvidis ke el ĝi povus kreski io vere bona.

AI tiam iĝis ne nur funkcio en la redaktilo, sed parto de la disvolva procezo. Ĝi multe akcelis plibonigon de la koda strukturo, vastigon de la Markdown-bildigo, aldonon de agorda menuo kaj modelo-elekto, reverkon de la README kaj poluradon de la instalado.

La antaŭa unudosiera provo fariĝis instalebla, uzebla kaj prezentebla libera projekto.

## Instalado

Por provi ĝin:

```bash
git clone https://github.com/fMert/Queyntisen.git
cd Queyntisen
chmod +x install.sh
./install.sh
```

Post instalado remalfermu la terminalon kaj rulu:

```bash
queyntisen notes.md
```

Por mana lanĉo:

```bash
pip install -r requirements.txt
python3 editor.py notes.md
```

## Konkludo

Queyntisen ankoraŭ estas juna projekto. Ĝi ne havas la grandan ekosistemon, aldonaĵan merkaton aŭ poŝtelefonan programon de Obsidian. Sed por mi ĝi havas klaran avantaĝon: ĝi kongruas kun mia labormaniero.

Ĝi restas en la terminalo, metas Markdown en la centron kaj traktas AI kiel kernan parton de la laborfluo, ne kiel poste algluitan aldonaĵon.

Se vi ŝatas konservi notojn kiel Markdown, ŝatas la ideon de Obsidian sed preferas malpezan, terminalan kaj AI-centran ilon al granda Electron-programo, Queyntisen celas plenigi ĝuste tiun bezonon.

La fontkodo estas ĉi tie:

[github.com/fMert/Queyntisen](https://github.com/fMert/Queyntisen)
