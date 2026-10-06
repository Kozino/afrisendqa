/**
 * Language context — exactly six languages, matching the app's customer base:
 * English, French, Arabic (RTL), Swahili, Luganda, Twi.
 *
 * `t(key)` returns undefined when a key is not translated, which lets each
 * screen fall back to its own English string instead of showing a raw key.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const languages = [
  { id: 'en', name: 'English (US)', nativeName: 'English', flag: '🇺🇸', rtl: false },
  { id: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', rtl: false },
  { id: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇶🇦', rtl: true },
  { id: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪', rtl: false },
  { id: 'lg', name: 'Luganda', nativeName: 'Oluganda', flag: '🇺🇬', rtl: false },
  { id: 'tw', name: 'Ghana (Twi)', nativeName: 'Akan / Twi', flag: '🇬🇭', rtl: false },
];

const STORAGE_KEY = 'afrisend.language';

const translations = {
  en: {
    goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening',
    welcomeBack: 'Welcome back', sendMoney: 'Send money', fundWallet: 'Fund wallet',
    activity: 'Activity', recipients: 'Recipients', profile: 'Profile', settings: 'Settings',
    availableBalance: 'Available balance', recentTransfers: 'Recent transfers', seeAll: 'See all',
    today: 'Today', languageAndRegion: 'Language & Region', selectLanguage: 'Select your language',
    continueBtn: 'Continue', continueLabel: 'Continue', cancel: 'Cancel', confirm: 'Confirm',
    back: 'Back', done: 'Done', next: 'Next', retry: 'Retry',
    amountToSend: 'Amount to send', youSend: 'You send', theyReceive: 'They receive',
    fee: 'Transfer fee', totalToPay: 'Total to pay', exchangeRate: 'Exchange rate',
    recipientGets: 'Recipient gets', confirmTransfer: 'Confirm transfer', reviewTransfer: 'Review transfer',
    enterPin: 'Enter your 6-digit PIN', processing: 'Processing', securingConnection: 'Securing banking network connection…',
    debitingWallet: 'Debiting AfriSend wallet…', disbursingFunds: 'Routing instant payout to beneficiary…',
    transferSuccess: 'Transfer successful', transferSent: 'Your money is on its way',
    verifyIdentity: 'Verify your identity', kycRequired: 'Identity check required',
    uploadId: 'Upload your Qatar ID', takeSelfie: 'Take a live selfie', submitting: 'Submitting…',
    fundWalletTitle: 'Fund your wallet', addCard: 'Add card', bankTransfer: 'Bank transfer',
    walletFunded: 'Wallet funded', insufficientFunds: 'Insufficient wallet balance',
    signIn: 'Sign in', signUp: 'Create account', phoneNumber: 'Phone number',
    enterOtp: 'Enter the 6-digit code we sent you', resendCode: 'Resend code',
    fullName: 'Full name', email: 'Email address', security: 'Security',
    transactionPin: 'Transaction PIN', helpSupport: 'Help & support', signOut: 'Sign out',
    noTransfersYet: 'No transfers yet', startFirstTransfer: 'Send your first transfer to see it here',
    somethingWentWrong: 'Something went wrong', tryAgain: 'Please try again',
  },
  fr: {
    goodMorning: 'Bonjour', goodAfternoon: 'Bon après-midi', goodEvening: 'Bonsoir',
    welcomeBack: 'Bon retour', sendMoney: 'Envoyer de l’argent', fundWallet: 'Alimenter le portefeuille',
    activity: 'Activité', recipients: 'Bénéficiaires', profile: 'Profil', settings: 'Paramètres',
    availableBalance: 'Solde disponible', recentTransfers: 'Transferts récents', seeAll: 'Tout voir',
    languageAndRegion: 'Langue et région', selectLanguage: 'Choisissez votre langue',
    continueBtn: 'Continuer', continueLabel: 'Continuer', cancel: 'Annuler', confirm: 'Confirmer',
    back: 'Retour', done: 'Terminé', next: 'Suivant', retry: 'Réessayer',
    amountToSend: 'Montant à envoyer', youSend: 'Vous envoyez', theyReceive: 'Ils reçoivent',
    fee: 'Frais de transfert', totalToPay: 'Total à payer', exchangeRate: 'Taux de change',
    recipientGets: 'Le bénéficiaire reçoit', confirmTransfer: 'Confirmer le transfert', reviewTransfer: 'Vérifier le transfert',
    enterPin: 'Entrez votre code PIN à 6 chiffres', processing: 'Traitement', securingConnection: 'Connexion bancaire sécurisée…',
    debitingWallet: 'Débit du portefeuille AfriSend…', disbursingFunds: 'Paiement instantané en cours…',
    transferSuccess: 'Transfert réussi', transferSent: 'Votre argent est en route',
    verifyIdentity: 'Vérifiez votre identité', kycRequired: 'Vérification d’identité requise',
    uploadId: 'Téléchargez votre carte d’identité', takeSelfie: 'Prenez un selfie en direct', submitting: 'Envoi…',
    fundWalletTitle: 'Alimentez votre portefeuille', addCard: 'Ajouter une carte', bankTransfer: 'Virement bancaire',
    walletFunded: 'Portefeuille alimenté', insufficientFunds: 'Solde insuffisant',
    signIn: 'Connexion', signUp: 'Créer un compte', phoneNumber: 'Numéro de téléphone',
    enterOtp: 'Entrez le code à 6 chiffres envoyé par SMS', resendCode: 'Renvoyer le code',
    fullName: 'Nom complet', email: 'Adresse e-mail', security: 'Sécurité',
    transactionPin: 'Code PIN de transaction', helpSupport: 'Aide et support', signOut: 'Déconnexion',
    noTransfersYet: 'Aucun transfert', startFirstTransfer: 'Envoyez votre premier transfert',
    somethingWentWrong: 'Une erreur est survenue', tryAgain: 'Veuillez réessayer',
  },
  ar: {
    goodMorning: 'صباح الخير', goodAfternoon: 'مساء الخير', goodEvening: 'مساء الخير',
    welcomeBack: 'مرحباً بعودتك', sendMoney: 'تحويل الأموال', fundWallet: 'تعبئة المحفظة',
    activity: 'النشاط', recipients: 'المستفيدون', profile: 'الملف الشخصي', settings: 'الإعدادات',
    availableBalance: 'الرصيد المتاح', recentTransfers: 'التحويلات الأخيرة', seeAll: 'عرض الكل',
    languageAndRegion: 'اللغة والمنطقة', selectLanguage: 'اختر لغتك',
    continueBtn: 'متابعة', continueLabel: 'متابعة', cancel: 'إلغاء', confirm: 'تأكيد',
    back: 'رجوع', done: 'تم', next: 'التالي', retry: 'إعادة المحاولة',
    amountToSend: 'المبلغ المرسل', youSend: 'أنت ترسل', theyReceive: 'يستلمون',
    fee: 'رسوم التحويل', totalToPay: 'الإجمالي المستحق', exchangeRate: 'سعر الصرف',
    recipientGets: 'يستلم المستفيد', confirmTransfer: 'تأكيد التحويل', reviewTransfer: 'مراجعة التحويل',
    enterPin: 'أدخل رمز PIN المكوّن من 6 أرقام', processing: 'جارٍ المعالجة', securingConnection: 'تأمين الاتصال المصرفي…',
    debitingWallet: 'خصم من محفظة أفري سيند…', disbursingFunds: 'تحويل فوري إلى المستفيد…',
    transferSuccess: 'تم التحويل بنجاح', transferSent: 'أموالك في الطريق',
    verifyIdentity: 'تحقق من هويتك', kycRequired: 'مطلوب التحقق من الهوية',
    uploadId: 'ارفع بطاقة الهوية القطرية', takeSelfie: 'التقط صورة شخصية مباشرة', submitting: 'جارٍ الإرسال…',
    fundWalletTitle: 'تعبئة محفظتك', addCard: 'إضافة بطاقة', bankTransfer: 'تحويل بنكي',
    walletFunded: 'تم تعبئة المحفظة', insufficientFunds: 'الرصيد غير كافٍ',
    signIn: 'تسجيل الدخول', signUp: 'إنشاء حساب', phoneNumber: 'رقم الهاتف',
    enterOtp: 'أدخل الرمز المكوّن من 6 أرقام', resendCode: 'إعادة إرسال الرمز',
    fullName: 'الاسم الكامل', email: 'البريد الإلكتروني', security: 'الأمان',
    transactionPin: 'رمز PIN للعمليات', helpSupport: 'المساعدة والدعم', signOut: 'تسجيل الخروج',
    noTransfersYet: 'لا توجد تحويلات بعد', startFirstTransfer: 'أرسل أول تحويل لك',
    somethingWentWrong: 'حدث خطأ ما', tryAgain: 'يرجى المحاولة مرة أخرى',
  },
  sw: {
    goodMorning: 'Habari za asubuhi', goodAfternoon: 'Habari za mchana', goodEvening: 'Habari za jioni',
    welcomeBack: 'Karibu tena', sendMoney: 'Tuma pesa', fundWallet: 'Ongeza kwenye pochi',
    activity: 'Shughuli', recipients: 'Wapokeaji', profile: 'Wasifu', settings: 'Mipangilio',
    availableBalance: 'Salio linalopatikana', recentTransfers: 'Uhamisho wa hivi karibuni', seeAll: 'Ona zote',
    languageAndRegion: 'Lugha na eneo', selectLanguage: 'Chagua lugha yako',
    continueBtn: 'Endelea', continueLabel: 'Endelea', cancel: 'Ghairi', confirm: 'Thibitisha',
    back: 'Rudi', done: 'Imekamilika', next: 'Ifuatayo', retry: 'Jaribu tena',
    amountToSend: 'Kiasi cha kutuma', youSend: 'Unatuma', theyReceive: 'Wanapokea',
    fee: 'Ada ya uhamisho', totalToPay: 'Jumla ya kulipa', exchangeRate: 'Kiwango cha ubadilishaji',
    recipientGets: 'Mpokeaji anapata', confirmTransfer: 'Thibitisha uhamisho', reviewTransfer: 'Angalia uhamisho',
    enterPin: 'Weka PIN yako ya tarakimu 6', processing: 'Inachakata', securingConnection: 'Kuunganisha benki kwa usalama…',
    debitingWallet: 'Tunatoa kwenye pochi ya AfriSend…', disbursingFunds: 'Tunatuma malipo kwa mpokeaji…',
    transferSuccess: 'Uhamisho umefanikiwa', transferSent: 'Pesa zako zinaenda',
    verifyIdentity: 'Thibitisha utambulisho wako', kycRequired: 'Uthibitisho wa utambulisho unahitajika',
    uploadId: 'Pakia kitambulisho chako cha Qatar', takeSelfie: 'Piga picha ya uso', submitting: 'Inatuma…',
    fundWalletTitle: 'Ongeza pesa kwenye pochi', addCard: 'Ongeza kadi', bankTransfer: 'Uhamisho wa benki',
    walletFunded: 'Pochi imeongezwa', insufficientFunds: 'Salio halitoshi',
    signIn: 'Ingia', signUp: 'Fungua akaunti', phoneNumber: 'Namba ya simu',
    enterOtp: 'Weka msimbo wa tarakimu 6', resendCode: 'Tuma msimbo tena',
    fullName: 'Jina kamili', email: 'Barua pepe', security: 'Usalama',
    transactionPin: 'PIN ya malipo', helpSupport: 'Msaada', signOut: 'Toka',
    noTransfersYet: 'Hakuna uhamisho bado', startFirstTransfer: 'Tuma uhamisho wako wa kwanza',
    somethingWentWrong: 'Kuna hitilafu', tryAgain: 'Tafadhali jaribu tena',
  },
  lg: {
    goodMorning: 'Wasuze otya', goodAfternoon: 'Osiibye otya', goodEvening: 'Osiibye otya',
    welcomeBack: 'Tukwanirizza nate', sendMoney: 'Weereza ssente', fundWallet: 'Jjuza wallet',
    activity: 'Ebikoleddwa', recipients: 'Abaweebwa', profile: 'Profile', settings: 'Entegeka',
    availableBalance: 'Sente eziriwo', recentTransfers: 'Ebiweerezebwa ebyaakaggwa', seeAll: 'Laba byonna',
    languageAndRegion: 'Olulimi n’ekitundu', selectLanguage: 'Londa olulimi lwo',
    continueBtn: 'Genda mu maaso', continueLabel: 'Genda mu maaso', cancel: 'Sazaamu', confirm: 'Kakasa',
    back: 'Ddayo', done: 'Kiwedde', next: 'Ekiddako', retry: 'Ddamu ogezeeko',
    amountToSend: 'Omuwendo oguweereza', youSend: 'Oweereza', theyReceive: 'Bafuna',
    fee: 'Ebisale by’okuweereza', totalToPay: 'Omuwendo gwonna', exchangeRate: 'Ekiwendo ky’enkyusa',
    recipientGets: 'Aweebwa afuna', confirmTransfer: 'Kakasa okweereza', reviewTransfer: 'Kebera okweereza',
    enterPin: 'Yingiza PIN yo ey’ennamba 6', processing: 'Tukola', securingConnection: 'Tukwata banka bulungi…',
    debitingWallet: 'Tuggya ku wallet ya AfriSend…', disbursingFunds: 'Tuweereza ssente eri aweebwa…',
    transferSuccess: 'Okweereza kuwedde bulungi', transferSent: 'Ssente zo zituuse',
    verifyIdentity: 'Kakasa obwaani bwo', kycRequired: 'Kikwetaagisa okukakasa obwaani',
    uploadId: 'Teekawo QID yo', takeSelfie: 'Kuba ekifaananyi ky’obwongo', submitting: 'Tuweereza…',
    fundWalletTitle: 'Jjuza wallet yo', addCard: 'Yongerako kaadi', bankTransfer: 'Okusindika mu banka',
    walletFunded: 'Wallet ejjudde', insufficientFunds: 'Ssente tezimala',
    signIn: 'Yingira', signUp: 'Fungula akawunti', phoneNumber: 'Ennamba ya ssimu',
    enterOtp: 'Yingiza ennamba 6 gye tukuwerezza', resendCode: 'Ddamu oweereze ennamba',
    fullName: 'Amannya gonna', email: 'Email', security: 'Obukuumi',
    transactionPin: 'PIN y’okweereza', helpSupport: 'Obuyambi', signOut: 'Fuluma',
    noTransfersYet: 'Tewali kuweereza', startFirstTransfer: 'Weereza okusooka',
    somethingWentWrong: 'Waliwo ekizibu', tryAgain: 'Ddamu ogezeeko',
  },
  tw: {
    goodMorning: 'Maakye', goodAfternoon: 'Maaha', goodEvening: 'Anwummerɛ',
    welcomeBack: 'Akwaaba bio', sendMoney: 'Soma sika', fundWallet: 'Fa sika gu wallet mu',
    activity: 'Adwuma a yɛayɛ', recipients: 'Wɔn a wɔgye', profile: 'Wo ho nsɛm', settings: 'Nhyehyɛe',
    availableBalance: 'Sika a ɛwɔ hɔ', recentTransfers: 'Sika a woasoma nnansa yi', seeAll: 'Hwɛ ne nyinaa',
    languageAndRegion: 'Kasa ne mpɔtam', selectLanguage: 'Paw wo kasa',
    continueBtn: 'Toa so', continueLabel: 'Toa so', cancel: 'Twa mu', confirm: 'Si so dua',
    back: 'San kɔ', done: 'Awie', next: 'Nea ɛto so', retry: 'Sɔ hwɛ bio',
    amountToSend: 'Sika dodow a wosoma', youSend: 'Wosoma', theyReceive: 'Wɔgye',
    fee: 'Soma ka', totalToPay: 'Ne nyinaa a wubetua', exchangeRate: 'Sika ntɛm',
    recipientGets: 'Nea ɔgye no', confirmTransfer: 'Si so dua', reviewTransfer: 'Hwɛ nsɛm no',
    enterPin: 'Fa wo PIN a ɛyɛ nɔma 6', processing: 'Ɛrekɔ so', securingConnection: 'Yɛne sikakorabea redi nkitaho…',
    debitingWallet: 'Yɛrete sika afi AfriSend wallet mu…', disbursingFunds: 'Yɛresoma sika ma ɔgyefo…',
    transferSuccess: 'Soma no kɔɔ yie', transferSent: 'Wo sika rekɔ',
    verifyIdentity: 'Si wo nipasu so dua', kycRequired: 'Ɛsɛ sɛ wosi nipasu so dua',
    uploadId: 'Fa wo QID ka ho', takeSelfie: 'Fa w’anim mfonini', submitting: 'Ɛrekɔ…',
    fundWalletTitle: 'Fa sika gu wo wallet mu', addCard: 'Fa kaadi ka ho', bankTransfer: 'Bank nkitaho',
    walletFunded: 'Wallet anya sika', insufficientFunds: 'Sika no nnɔɔso',
    signIn: 'Bra mu', signUp: 'Bue akontaabu', phoneNumber: 'Telefon nɔma',
    enterOtp: 'Fa nɔma 6 a yɛsomaa no', resendCode: 'Soma nɔma no bio',
    fullName: 'Din nyinaa', email: 'Email', security: 'Ahobammɔ',
    transactionPin: 'Soma PIN', helpSupport: 'Mmoa', signOut: 'Fi mu',
    noTransfersYet: 'Soma biara nni hɔ', startFirstTransfer: 'Soma nea ɛdi kan',
    somethingWentWrong: 'Biribi ankɔ yie', tryAgain: 'Yɛ bi bio',
  },
};

const LanguageContext = createContext({
  lang: 'en',
  setLang: () => {},
  t: (key) => translations.en[key],
  isRTL: false,
  languages,
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved && translations[saved]) setLangState(saved);
      })
      .catch(() => {});
  }, []);

  const value = useMemo(() => ({
    lang,
    languages,
    isRTL: Boolean((languages.find((l) => l.id === lang) || {}).rtl),
    setLang: (next) => {
      if (!translations[next]) return;
      setLangState(next);
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    },
    /**
     * Returns undefined when a key has no translation, so screens fall back to
     * their own English copy: `t('sendMoney') || 'Send money'`.
     */
    t: (key) => (translations[lang] ? translations[lang][key] : undefined),
  }), [lang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
export default LanguageContext;
