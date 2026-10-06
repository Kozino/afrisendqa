import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

const GREEN = '#084C38';

export default function LanguageScreen({ navigation }) {
  // 1. Get 'lang', 'setLang', and 't' from LanguageContext
  const { lang, setLang, t } = useLanguage();

  // The exact 6 original languages maintained
  const languages = [
    { id: 'en', name: 'English (US)', nativeName: 'English', flag: '🇺🇸' },
    { id: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
    { id: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇶🇦' },
    { id: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪' },
    { id: 'lg', name: 'Luganda', nativeName: 'Oluganda', flag: '🇺🇬' },
    { id: 'tw', name: 'Ghana (Twi)', nativeName: 'Akan / Twi', flag: '🇬🇭' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack && navigation.goBack()}
          style={styles.headerIconBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color="#083B2D" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('languageAndRegion') || 'Language & Region'}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.content}>
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="globe-outline" size={18} color="#084C38" style={{ marginTop: 1 }} />
          <Text style={styles.infoBannerText}>
            Selecting a language updates all currency displays, prompts, and SMS receipts across your account.
          </Text>
        </View>

        {/* Language List */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollList}
        >
          {languages.map((item) => {
            const isSelected = lang === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.langCard, isSelected && styles.langCardSelected]}
                onPress={() => setLang(item.id)} // Save selection globally!
                activeOpacity={0.75}
              >
                {/* Flag Icon */}
                <Text style={styles.flagEmoji}>{item.flag}</Text>

                {/* Text Details */}
                <View style={styles.langTextContainer}>
                  <Text style={styles.langName}>{item.name}</Text>
                  <Text style={styles.nativeName}>{item.nativeName}</Text>
                </View>

                {/* Selection Indicator */}
                {isSelected ? (
                  <View style={styles.selectedCircle}>
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  </View>
                ) : (
                  <View style={styles.unselectedCircle} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F0FAF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.3,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 11.5,
    color: '#065F46',
    lineHeight: 16,
    fontWeight: '500',
  },
  scrollList: {
    paddingBottom: 24,
    gap: 10,
  },
  langCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  langCardSelected: {
    borderColor: '#084C38',
    borderWidth: 1.8,
    backgroundColor: '#F0FAF5',
  },
  flagEmoji: {
    fontSize: 24,
    marginRight: 14,
  },
  langTextContainer: {
    flex: 1,
  },
  langName: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  nativeName: {
    fontSize: 12.5,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 2,
  },
  selectedCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#084C38',
    justifyContent: 'center',
    alignItems: 'center',
  },
  unselectedCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
});
