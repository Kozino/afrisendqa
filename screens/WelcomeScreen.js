import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ImageBackground,
  ScrollView,
  Dimensions,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
} from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguage } from '../LanguageContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const GREEN = '#084C38';
const AUTO_SCROLL_MS = 4000;

const heroSlides = [
  {
    image: { uri: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&auto=format&fit=crop&q=80' },
    badge: 'Trusted by 50,000+ Expats in Qatar',
    titleKey: 'connectingHearts',
    defaultTitle: 'Send Money to Africa Instantly',
    subtitleKey: 'welcomeSubtitle',
    defaultSubtitle: 'Best market exchange rates with zero hidden fees to Nigeria, Ghana & Kenya.',
  },
  {
    image: { uri: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&auto=format&fit=crop&q=80' },
    badge: 'Instant Bank & MoMo Transfers',
    titleKey: 'directToMobile',
    defaultTitle: 'Direct to Bank & Mobile Money',
    subtitleKey: 'directToMobileDesc',
    defaultSubtitle: 'Direct payouts to Access Bank, M-Pesa, MTN MoMo, Wave and more in minutes.',
  },
  {
    image: { uri: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&auto=format&fit=crop&q=80' },
    badge: 'Regulated by Qatar Central Bank',
    titleKey: 'secureFast',
    defaultTitle: 'Bank-Grade Security & Trust',
    subtitleKey: 'secureFastDesc',
    defaultSubtitle: '256-Bit SSL end-to-end encryption with 24/7 dedicated remittance support.',
  },
];

export default function WelcomeScreen({ navigation }) {
  // Safe translation & language hook
  let t = (key) => key;
  let currentLang = 'en';
  try {
    const langCtx = useLanguage();
    if (langCtx) {
      if (langCtx.t) t = langCtx.t;
      if (langCtx.lang) currentLang = langCtx.lang;
    }
  } catch (e) {
    console.log('LanguageContext fallback in WelcomeScreen:', e);
  }

  const insets = useSafeAreaInsets();
  const [activeSlide, setActiveSlide] = useState(0);
  const scrollRef = useRef(null);

  const HERO_HEIGHT = Math.round(SCREEN_HEIGHT * 0.43);

  const handleScroll = (e) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveSlide(index);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveSlide((prev) => {
        const next = (prev + 1) % heroSlides.length;
        scrollRef.current?.scrollTo({ x: next * SCREEN_WIDTH, animated: true });
        return next;
      });
    }, AUTO_SCROLL_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Hero Carousel with Linear Gradient Overlays */}
      <View style={{ height: HERO_HEIGHT, position: 'relative' }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
          style={[styles.hero, { height: HERO_HEIGHT }]}
        >
          {heroSlides.map((slide, index) => (
            <ImageBackground
              key={index}
              source={slide.image}
              style={[styles.heroSlide, { height: HERO_HEIGHT }]}
              resizeMode="cover"
            >
              {/* Luxury Gradient Overlays */}
              <LinearGradient
                colors={[
                  'rgba(8, 76, 56, 0.45)',
                  'rgba(8, 59, 45, 0.75)',
                  'rgba(8, 59, 45, 0.96)',
                ]}
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFill}
              />

              <View style={[styles.heroContent, { paddingTop: insets.top + 10 }]}>
                {/* Social Proof Trust Badge */}
                <View style={styles.trustedBadge}>
                  <MaterialIcons name="verified-user" size={13} color="#FFFFFF" />
                  <Text style={styles.trustedText}>{t(slide.badge) || slide.badge}</Text>
                </View>

                {/* Hero Headings */}
                <View style={styles.heroTextWrap}>
                  <Text style={styles.title}>
                    {t(slide.titleKey) !== slide.titleKey ? t(slide.titleKey) : slide.defaultTitle}
                  </Text>
                  <Text style={styles.subtitle}>
                    {t(slide.subtitleKey) !== slide.subtitleKey ? t(slide.subtitleKey) : slide.defaultSubtitle}
                  </Text>
                </View>
              </View>
            </ImageBackground>
          ))}
        </ScrollView>

        {/* Floating Global Language Switcher Pill (Top Right) */}
        <TouchableOpacity
          style={[styles.floatingLangBtn, { top: insets.top + 10 }]}
          onPress={() => navigation?.navigate && navigation.navigate('Language')}
          activeOpacity={0.8}
        >
          <Ionicons name="globe-outline" size={15} color="#FFFFFF" />
          <Text style={styles.floatingLangText}>{currentLang.toUpperCase()}</Text>
          <Ionicons name="chevron-down" size={12} color="rgba(255, 255, 255, 0.8)" />
        </TouchableOpacity>

        {/* Carousel Pagination Dots */}
        <View style={styles.dotsRow} pointerEvents="none">
          {heroSlides.map((_, index) => (
            <View
              key={index}
              style={[styles.dot, activeSlide === index && styles.dotActive]}
            />
          ))}
        </View>
      </View>

      {/* Main Body Section */}
      <View style={styles.body}>
        {/* Brand Logo & Name */}
        <View style={styles.logoRow}>
          <View style={styles.logoWrapper}>
            <Image
              source={require('../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
              defaultSource={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100' }}
            />
          </View>
          <Text style={styles.brandName}>AfriSend</Text>
        </View>

        <Text style={styles.welcomeHeading}>
          {t('welcomeBack') || 'Fast, Secure & Transparent'}
        </Text>
        <Text style={styles.welcomeSub}>
          {t('welcomeSubtitle') ||
            'Connecting families across Africa with guaranteed best live exchange rates from Qatar.'}
        </Text>

        {/* Primary Call-to-Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.loginButton}
            activeOpacity={0.85}
            onPress={() => navigation?.navigate && navigation.navigate('Login')}
          >
            <MaterialIcons name="login" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.loginButtonText}>{t('loginToAccount') || 'Log In to Account'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.createButton}
            activeOpacity={0.85}
            onPress={() => navigation?.navigate && navigation.navigate('CreateAccount')}
          >
            <MaterialIcons name="person-add-alt" size={18} color={GREEN} style={{ marginRight: 8 }} />
            <Text style={styles.createButtonText}>{t('createNewAccount') || 'Create New Account'}</Text>
          </TouchableOpacity>
        </View>

        {/* Feature Value Props */}
        <View style={styles.featuresContainer}>
          <View style={styles.featureItem}>
            <View style={[styles.featureIconWrap, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="flash" size={16} color="#D97706" />
            </View>
            <Text style={styles.featureTitle}>{t('instantDelivery') || 'Instant Payouts'}</Text>
            <Text style={styles.featureDesc}>{t('fundsArriveInMinutes') || 'Direct to Banks & Mobile Wallets'}</Text>
          </View>

          <View style={styles.featureItem}>
            <View style={[styles.featureIconWrap, { backgroundColor: '#E6F6ED' }]}>
              <MaterialCommunityIcons name="shield-check" size={17} color={GREEN} />
            </View>
            <Text style={styles.featureTitle}>{t('secureVault') || 'QCB Regulated'}</Text>
            <Text style={styles.featureDesc}>{t('endToEndEncryption') || 'Bank-Grade 256-Bit Encryption'}</Text>
          </View>
        </View>

        {/* Regulatory Footer */}
        <Text style={styles.footerText}>
          Regulated by Qatar Central Bank • Protected by 256-Bit SSL
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  hero: {
    width: '100%',
  },
  heroSlide: {
    width: SCREEN_WIDTH,
    justifyContent: 'flex-end',
  },
  heroContent: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingBottom: 26,
  },
  trustedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  trustedText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11.5,
    letterSpacing: 0.2,
  },
  floatingLangBtn: {
    position: 'absolute',
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    gap: 5,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  floatingLangText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  heroTextWrap: {
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  subtitle: {
    color: '#D1FAE5',
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '400',
  },
  dotsRow: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
    width: 20,
    borderRadius: 3,
  },
  body: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    justifyContent: 'space-between',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 6,
  },
  logoWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  logo: {
    width: 36,
    height: 36,
  },
  brandName: {
    fontSize: 22,
    fontWeight: '800',
    color: GREEN,
    letterSpacing: -0.4,
  },
  welcomeHeading: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  welcomeSub: {
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 8,
  },
  buttonContainer: {
    width: '100%',
    marginVertical: 10,
  },
  loginButton: {
    flexDirection: 'row',
    backgroundColor: GREEN,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  createButton: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: GREEN,
  },
  createButtonText: {
    color: GREEN,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  featuresContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  featureItem: {
    flex: 1,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  featureIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  featureTitle: {
    fontWeight: '800',
    fontSize: 12,
    color: '#0F172A',
  },
  featureDesc: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 14,
  },
  footerText: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
  },
});
