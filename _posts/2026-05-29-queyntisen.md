---
title: Queyntisen — nova maniero programi per AI en la terminalo
date: 2026-05-29 20:00:00 +0300
categories: [Programado]
tags: [queyntisen, terminala-redaktilo, llm, vim, artefarita-inteligenteco, libera-programaro, python]
---

Antaŭ kelkaj monatoj mi verkis terminalan redaktilon de nulo. Ĝia nomo estas **Queyntisen**. Ĝi estas verkita en Python kaj inspirita de Vim, sed unu afero distingas ĝin: rekta integriĝo kun grandaj lingvomodeloj (LLM).

Imagu, ke vi programas kaj blokiĝas. Sen forlasi la redaktilon vi povas sendi la tutan dosieron al modelo kaj tuj ricevi korektitan version. Ĝuste tion Queyntisen faras.

## Kial verki propran redaktilon?

Ĝi naskiĝis el bezono. Mi uzas Vim kaj VS Code, sed iri tien kaj reen inter ili — kaj malfermi apartan fenestron por AI-asistanto — estis ĝene. Mi volis demandi modelon per unu klavo kaj vidi la respondon en la redaktilo mem. Do mi sidiĝis kaj verkis ĝin.

## Trajtoj

### Reĝima redaktado (la spirito de Vim)

Movado kaj komandoj en normala reĝimo, skribado en eniga reĝimo. Preskaŭ ĉio konata de Vim troviĝas ĉi tie:

- Movado per `hjkl` (ankaŭ la sagoklavoj funkcias)
- Forigo aŭ eltranĉo de linio per `dd`
- Kopiado de linio per `yy`
- Algluo per `p`
- Malfaro per `u` aŭ `Ctrl+Z`, kun plena historio
- Serĉo per `/`, antaŭa aŭ sekva trafo per `n`/`b`; la serĉo rekomenciĝas ĉe la fino de dosiero

### Dividita panelo: kodo kaj AI-babilo

Per `Ctrl+W` oni alternas inter la kodpanelo kaj AI-babilpanelo. La kodo okupas 70% de la ekrano kaj la babilo 30%. Tajpu demandon dekstre, premu Enter, kaj la AI liveros respondon.

![Ekrankopio de Queyntisen](https://raw.githubusercontent.com/fMert/Queyntisen/main/screenshot.png)

### Kiel funkcias la AI-integriĝo?

La grava afero estas, ke **la AI-laboro okazas en la fono**. La redaktilo ne frostiĝas, do vi povas daŭre skribi. La fluo estas jena:

1. Vi skribas peton en la babilpanelo ("faru ĉi tiun funkcion nesinkrona", "aldonu sencimigon" ktp.).
2. La nuna enhavo de la tuta dosiero estas aŭtomate sendata al la modelo kiel kunteksto.
3. La modelo produktas nur kodon, sen klarigoj aŭ Markdown, laŭ la sistema instrukcio.
4. La respondo estas aplikata rekte al la redaktila bufro.

Ĝi funkcias kun **lokaj modeloj** (LM Studio, Ollama) kaj kun la **OpenAI-API**. Ĉe lanĉo ĝi aŭtomate rekonas la konektitan modelon.

Ne estas aparta agordodosiero; nur du variabloj ĉe la supro de `editor.py`:

```python
# Por loka LLM (defaŭlte)
API_KEY = "lm-studio"
BASE_URL = "http://localhost:1234/v1"

# Por la OpenAI-API
API_KEY = os.getenv("OPENAI_API_KEY")
BASE_URL = "https://api.openai.com/v1"
```

### Sintaksa kolorigo

Python-ŝlosilvortoj estas bluaj, ĉenoj flavaj, komentoj verdaj kaj nombroj magentaj. La kolorskemo estas simpla kaj agrabla por la okuloj.

### Lininombroj

Vim-uzantoj konas tri reĝimojn:

- `:numara goreli` — montras la distancon de la kursoro (kiel `relativenumber` en Vim)
- `:numara normal` — montras la verajn lininombrojn
- `:numara yok` — kaŝas lininombrojn

### Subteno de muso

Vi povas klaki por movi la kursoron. Ankaŭ limigo ĉe linifinoj kaj kalkulo de marĝenoj estas prizorgitaj.

### Saĝaj Backspace kaj Tab

Tab aldonas kvar spacojn. Backspace forigas ĉiujn kvar samtempe se ĝuste kvar spacoj troviĝas maldekstre de la kursoro. Malgranda detalo, sed ĝi helpas dum verkado.

## Instalado

Per unu komando:

```bash
git clone https://github.com/fMert/Queyntisen.git
cd Queyntisen
chmod +x install.sh
./install.sh
```

La skripto kreas virtualan Python-medion, instalas la bibliotekon `openai`, aldonas la komandon `queyntisen` al PATH kaj ĝisdatigas `.bashrc`, `.zshrc` aŭ `.profile`. Remalfermu la terminalon kaj rulu `queyntisen dosiero.py`.

Postuloj: Python 3.8+ kaj la biblioteko `openai`. Jen ĉio.

## Kio ankoraŭ mankas?

Ĉi tio ne estas finita produkto. Ĝi estas eksperimenta projekto, al kiu ankoraŭ mankas:

- Vida reĝimo por elekto kaj grupa redaktado
- Subteno de pluraj dosieroj (bufroj aŭ langetoj)
- Lingvokonscia sintaksa kolorigo; nun ĝi uzas nur regulesprimojn
- Kolorigo de ŝlosilvortoj por lingvoj aliaj ol Python
- Konservado de babilhistorio

Tamen ĝi funkcias. Mi uzas ĝin por miaj malgrandaj skriptoj jam de kelkaj monatoj.

## Kial "Queyntisen"?

*Queyntisen* estas mezangla vorto signifanta "ornami sin; surmeti belajn vestojn". Ĝi devenas de *queyntise* ("lerteco, rafiniteco, eleganteco") kaj la infinitiva finaĵo *-en*.

La ideo, ke redaktilo "ornamas" kodon kaj faras ĝin pli kapabla per AI, taŭgas al la nomo. Krome ĝi estas unika kaj sonas bele.

## Fontkodo

La projekto estas [libera ĉe GitHub](https://github.com/fMert/Queyntisen) sub GPL v3. Ĝi konsistas el unu dosiero, `editor.py` (ĉirkaŭ 870 linioj). Vi rajtas ĝin esplori, forki kaj plibonigi.
