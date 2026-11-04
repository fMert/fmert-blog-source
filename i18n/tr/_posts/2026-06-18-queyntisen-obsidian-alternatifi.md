---
title: Queyntisen Artık Bir Obsidian Alternatifi
date: 2026-06-18 01:20:00 +0300
categories: [Proje]
tags: [queyntisen, markdown, obsidian, terminal, yapay-zeka, python, acik-kaynak]
---

Yaklaşık dört ay önce Python ile çok basit bir terminal editörü yazmıştım: **Queyntisen**.

O zamanlar fikir çok küçüktü. Terminalde çalışan, Markdown dosyalarını açabilen, biraz Vim hissi veren, sağ tarafta da basit bir AI paneli olan deneysel bir editör. Çalışıyordu ama dürüst olmak gerekirse daha çok "hafta sonu projesi" gibiydi. Sonra projeye uzun süre dokunmadım.

Son günlerde Queyntisen'i yeniden açtım ve AI yardımıyla projeyi inanılmaz derecede ileri taşıdım. Artık sadece basit bir terminal editörü değil; Markdown notları için ciddi ciddi kullanılabilecek, AI destekli, terminal-native bir çalışma alanına dönüşmeye başladı.

![Queyntisen Ekran Görüntüsü](https://raw.githubusercontent.com/fMert/Queyntisen/main/screenshot.png)

## Obsidian'a Terminalden Bir Alternatif

Obsidian çok güçlü bir uygulama. Markdown tabanlı olması, notları düz dosya olarak saklaması ve plugin ekosistemi sayesinde birçok kişi için vazgeçilmez hale geldi. Ama benim için her zaman küçük bir problem vardı: Obsidian sonuçta Electron tabanlı bir masaüstü uygulaması.

Ben günümün büyük kısmını terminalde geçiriyorum. Kod yazarken, not alırken, dosya düzenlerken sürekli terminaldeyim. Bir notu düzenlemek için ayrı bir GUI uygulamasına geçmek bana hep biraz fazla geldi.

Queyntisen tam burada devreye giriyor.

Queyntisen, Obsidian'ın sevdiğim tarafını — Markdown dosyalarıyla çalışma fikrini — alıp terminale taşıyor. Ama bunu sadece "terminalde açılan basit bir metin editörü" olarak yapmıyor. Varsayılan olarak Markdown dosyasını güzel bir preview görünümünde açıyor. İstediğin zaman `Ctrl-E` ile ham Markdown düzenleme moduna geçebiliyorsun.

Yani okurken temiz ve düzenli bir not görünümü, yazarken doğrudan kaynak Markdown kontrolü var.

## Neden Bana Göre Daha İyi?

Burada "daha iyi" derken herkes için mutlak bir iddia atmıyorum. Obsidian devasa bir ekosistem. Ama benim kullanım şeklim için Queyntisen daha doğru bir yere oturuyor.

Birincisi, terminalde çalışıyor. Electron yok, ağır arayüz yok, fareyle pencere arama yok. Klavyeden çıkmadan notu aç, oku, düzenle, kaydet.

İkincisi, AI sonradan eklenmiş bir plugin gibi değil. Queyntisen'in merkezinde AI var. Obsidian'da AI kullanmak istediğinde genelde plugin arıyorsun, ayar yapıyorsun, başka paneller açıyorsun, bazen dış araçlarla uğraşıyorsun. Queyntisen'de ise sağ tarafta doğrudan bir AI paneli var.

`Ctrl-W` ile AI paneline geçiyorsun, isteğini yazıyorsun, Enter'a basıyorsun. Queyntisen mevcut Markdown dosyasının tamamını bağlam olarak modele gönderiyor. Model notu baştan düzenlenmiş şekilde geri döndürüyor ve sonuç doğrudan editör buffer'ına uygulanıyor.

Notu toparlatmak, başlıklandırmak, yapılacaklar listesine çevirmek, toplantı notu formatına sokmak, daha kısa ve net hale getirmek gibi işler için bu akış çok doğal hissettiriyor.

## AI Entegrasyonu Nasıl Çalışıyor?

Queyntisen'in AI tarafı özellikle Markdown yazımı için tasarlandı. Sağ paneldeki asistan, açık olan notun tamamını görüyor. Bu önemli, çünkü modele sadece seçili birkaç satırı değil, belgenin bütün bağlamını veriyorsun.

Örneğin şöyle bir şey yazabiliyorsun:

```text
Bu notu daha düzenli bir proje planına çevir.
```

Ya da:

```text
Başlıkları düzelt, tekrar eden yerleri temizle ve aksiyon maddelerini task list yap.
```

Model, belgenin tamamını okuyup daha iyi organize edilmiş bir Markdown dokümanı üretiyor. Queyntisen de bu çıktıyı mevcut buffer'a uyguluyor.

Bunun güzel tarafı şu: AI isteği arka planda çalışıyor. Editör tamamen donup kalmıyor. Ayrıca sağlayıcı ayarları da artık editörün içinde yapılabiliyor.

`:setup` komutuyla provider seçiyorsun. OpenAI, Anthropic, DeepSeek, OpenRouter, LM Studio, Ollama ve diğer OpenAI uyumlu endpoint'ler destekleniyor. Yerel model kullanmak istersen LM Studio veya Ollama ile çalışabiliyor. API tabanlı model kullanmak istersen onu da aynı menüden ayarlayabiliyorsun.

`:model` komutuyla da kullanılabilir modelleri gezip seçebiliyorsun. Seçimler `~/.config/queyntisen/config.json` altında saklanıyor.

## Markdown Preview Artık Ciddi Seviyede

İlk sürümde Queyntisen daha çok ham metin düzenleme tarafına yakındı. Şimdi ise Markdown preview tarafı çok daha kullanışlı.

Desteklenen şeylerden bazıları:

- başlıklar,
- paragraflar,
- madde listeleri,
- numaralı listeler,
- task list'ler,
- alıntılar,
- yatay çizgiler,
- fenced code block'lar,
- inline code,
- bold / italic / strikethrough,
- linkler,
- görseller,
- autolink'ler,
- tablolar.

Bu, Queyntisen'i sadece "dosya açıp yazı yazılan" bir araç olmaktan çıkarıyor. Terminalde not okuma deneyimi de gerçekten hoş hale geliyor.

## Modal Düzenleme ve Komutlar

Queyntisen hâlâ Vim'den esinlenen modal bir yapıya sahip. Source modunda normal mod ve insert mod var. `hjkl` ile gezinme, `dd` ile satır silme, `yy` ile satır kopyalama, `p` ile yapıştırma, `u` ile geri alma gibi alışıldık hareketler bulunuyor.

Komut tarafında da temel şeyler var:

```text
:w
:q
:wq
:x
:setup
:model
```

Ayrıca `:` komut satırında `Tab` ile autocomplete çalışıyor. Küçük bir detay gibi görünüyor ama terminal editöründe çok iyi hissettiriyor.

## Dört Ay Sonra AI ile Geri Dönmek

Bence bu projenin en ilginç tarafı sadece Queyntisen'in kendisi değil, geliştirme süreci.

Dört ay önce bunu Python ile süper temel bir editör olarak yazdım. Sonra kenarda kaldı. Yakın zamanda tekrar açtığımda eski haline baktım ve "buradan gerçekten güzel bir şey çıkabilir" dedim.

Bu noktada AI, sadece editörün içindeki bir özellik olmadı; geliştirme sürecinin de parçası oldu. Kodun yapısını iyileştirmek, Markdown rendering tarafını genişletmek, setup menüsü eklemek, model seçimini toparlamak, README'yi yeniden yazmak, kurulum akışını daha düzgün hale getirmek gibi işlerde AI ciddi şekilde hız kazandırdı.

Eskiden tek dosyalık basit bir deneme olan şey, şimdi gerçekten kurulabilir, kullanılabilir ve anlatılabilir bir açık kaynak projeye dönüştü.

## Kurulum

Denemek için:

```bash
git clone https://github.com/fMert/Queyntisen.git
cd Queyntisen
chmod +x install.sh
./install.sh
```

Kurulumdan sonra terminali yeniden başlatıp şöyle çalıştırabilirsin:

```bash
queyntisen notes.md
```

Manuel çalıştırmak istersen:

```bash
pip install -r requirements.txt
python3 editor.py notes.md
```

## Sonuç

Queyntisen hâlâ genç bir proje. Obsidian kadar büyük bir ekosistemi yok, plugin pazarı yok, mobil uygulaması yok. Ama benim için çok net bir avantajı var: tam olarak benim çalışma şeklime uyuyor.

Terminalde kalıyor. Markdown'ı merkeze alıyor. AI entegrasyonunu sonradan yamalanmış bir özellik gibi değil, ana akışın parçası olarak sunuyor.

Eğer notlarını Markdown olarak tutmayı seviyorsan, Obsidian fikrini seviyor ama Electron tabanlı büyük bir masaüstü uygulaması yerine terminalde çalışan daha hafif ve AI-native bir şey istiyorsan, Queyntisen tam olarak bu boşluğu doldurmayı hedefliyor.

Kaynak kodu burada:

[github.com/fMert/Queyntisen](https://github.com/fMert/Queyntisen)
