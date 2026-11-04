---
title: Queyntisen – Terminalde Yapay Zeka ile Kod Yazmanın Yeni Yolu
date: 2026-05-29 20:00:00 +0300
categories: [Yazılım]
tags: [queyntisen, terminal-editor, llm, vim, yapay-zeka, acik-kaynak, python]
---

Birkaç ay önce sıfırdan bir terminal editörü yazdım. Adı **Queyntisen**. Python ile yazılmış, Vim'den esinlenmiş ama onu farklı kılan bir şey var: Büyük Dil Modelleri (LLM) ile doğal entegrasyon.

Düşünsene — kod yazıyorsun, bir yerde takıldın. Editörden çıkmadan, dosyanın tamamını modele gönderip düzeltilmiş halini anında alabiliyorsun. Queyntisen tam olarak bunu yapıyor.

## Neden Kendi Editörünü Yazdın?

Aslında ihtiyaçtan doğdu. Vim kullanıyorum, VS Code kullanıyorum. Ama ikisi arasında gidip gelmek, hele ki AI asistanı için ayrı bir pencereyle uğraşmak can sıkıcıydı. "Keşke editörün içinde, bir tuşla modele sorabilsem ve cevabı yine editörde görebilsem" dedim. Sonra da oturup yazdım.

## Özellikler

### Modal Düzenleme (Vim Ruhu)

Normal modda gezinme ve komutlar, Insert modda yazma. Vim'den alışkın olduğun neredeyse her şey var:

- `hjkl` ile gezinme (ok tuşları da çalışıyor)
- `dd` ile satır sil/kes
- `yy` ile satır kopyala (yank)
- `p` ile yapıştır
- `u` veya `Ctrl+Z` ile geri al — tam bir history stack ile
- `/` ile arama, `n`/`b` ile sonraki/önceki eşleşme (dosya sonuna gelince başa sarar)

### Bölünmüş Panel: Kod + AI Sohbet

`Ctrl+W` ile kod paneli ve AI sohbet paneli arasında geçiş yapıyorsun. Ekranın %70'i kod, %30'u sohbet. Sağ panele sorunu yaz, Enter'a bas — AI cevabı yapıştırsın.

![Queyntisen Ekran Görüntüsü](https://raw.githubusercontent.com/fMert/Queyntisen/main/screenshot.png)

### AI Entegrasyonu Nasıl Çalışıyor?

İşin güzel yanı: **AI işlemi arka planda çalışıyor.** Editör donmuyor, sen yazmaya devam edebiliyorsun. Sistem şöyle işliyor:

1. Chat paneline isteğini yazıyorsun ("Bu fonksiyonu async yap", "Hata ayıklama ekle", vs.)
2. Dosyanın mevcut içeriği otomatik olarak modele bağlam (context) olarak gönderiliyor
3. Model sadece kodu üretiyor (açıklama yok, markdown yok — sistem prompt'u öyle ayarladım)
4. Dönen kod direkt editör buffer'ına uygulanıyor

Hem **yerel modellerle** (LM Studio, Ollama) hem de **OpenAI API** ile çalışıyor. Başlangıçta hangi modelin bağlı olduğunu otomatik algılıyor.

Konfigürasyon dosyası yok, sadece `editor.py`'nin üstündeki iki değişken:

```python
# Yerel LLM için (varsayılan)
API_KEY = "lm-studio"
BASE_URL = "http://localhost:1234/v1"

# OpenAI API için
API_KEY = os.getenv("OPENAI_API_KEY")
BASE_URL = "https://api.openai.com/v1"
```

### Syntax Highlighting

Python anahtar kelimeleri mavi, string'ler sarı, yorum satırları yeşil, sayılar magenta. Sade, göz yormayan bir renk paleti.

### Satır Numaralandırma

Vim kullanıcıları bilir — üç mod var:

- `:numara goreli` — imlece olan uzaklığı gösterir (Vim'in `relativenumber`)
- `:numara normal` — gerçek satır numaraları
- `:numara yok` — numaraları kapat

### Mouse Desteği

Fareyle tıklayıp imleci istediğin yere taşıyabiliyorsun. Satır sonuna clamping, margin hesaplaması — hepsi düşünüldü.

### Akıllı Backspace ve Tab

Tab tuşu 4 boşluk ekliyor. Backspace ile silerken, eğer imlecin solunda tam 4 boşluk varsa hepsini birden siliyor. Küçük ama yazarken fark eden bir detay.

## Kurulum

Tek komutla:

```bash
git clone https://github.com/fMert/Queyntisen.git
cd Queyntisen
chmod +x install.sh
./install.sh
```

Script senin için venv oluşturuyor, `openai` kütüphanesini yüklüyor, `queyntisen` komutunu PATH'e ekliyor. Shell'in `.bashrc`, `.zshrc` veya `.profile` dosyasına otomatik PATH ayarını yapıyor. Terminali kapat-aç, `queyntisen dosya.py` yaz, çalış.

Gereksinimler: Python 3.8+ ve `openai` kütüphanesi. O kadar.

## Neler Eksik?

Bu bir "tamamlanmış ürün" değil. Deneysel bir proje. Şu an eksik olanlar:

- Görsel mod (Visual mode) — seçim yapıp toplu işlem
- Çoklu dosya desteği (buffer switching / tabs)
- Dil bilgisi farkındalığı olmayan renklendirme (şu an sadece regex bazlı)
- Sadece Python anahtar kelimelerini highlight'lıyor
- Chat geçmişi kaydedilmiyor

Ama çalışıyor. İş görüyor. Ben birkaç aydır kendi küçük script'lerim için kullanıyorum.

## Neden "Queyntisen"?

Orta İngilizce (Middle English) bir kelime: *queyntisen*. Anlamı "süslenmek, güzel kıyafetlerle donanmak" (*to dress up; to adorn with fine clothing*). Etimolojisi: *queyntise* ("beceri, incelik, zarafet") + *-en* (mastar eki).

Bir editörün kodunu "süslemesi", AI ile daha yetkin hale getirmesi — isim tam oturuyor aslında. Kulağa hoş gelen, benzersiz bir kelime olması da bonus.

## Kaynak Kodu

Proje [GitHub'da](https://github.com/fMert/Queyntisen) açık kaynak, GPL v3 lisanslı. Tek dosya: `editor.py` (~870 satır). İncelemek, fork'lamak, katkı yapmak serbest.

---

