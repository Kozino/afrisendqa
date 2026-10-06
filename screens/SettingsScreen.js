import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Ionicons,
  MaterialIcons,
} from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

export default function SettingsScreen({ navigation }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in SettingsScreen:', e);
  }

  const [pushNotifications, setPushNotifications] = useState(true);
  const [rateAlerts, setRateAlerts] = useState(true);
  const [biometrics, setBiometrics] = useState(true);
  const [smsAlerts, setSmsAlerts] = useState(true);

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
        <Text style={styles.headerTitle}>{t('settings') || 'Settings'}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Section 1: Notifications & Alerts */}
        <Text style={styles.sectionLabel}>NOTIFICATIONS & ALERTS</Text>
        <View style={styles.menuCard}>
          {/* Push Notifications */}
          <View style={styles.menuItem}>
            <View style={[styles.menuIconBg, { backgroundColor: '#E0F2FE' }]}>
              <Ionicons name="notifications-outline" size={20} color="#0284C7" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('pushNotifications') || 'Push Notifications'}</Text>
              <Text style={styles.menuDesc}>Instant transaction alerts</Text>
            </View>
            <Switch
              value={pushNotifications}
              onValueChange={setPushNotifications}
              trackColor={{ false: '#E2E8F0', true: '#A7F3D0' }}
              thumbColor={pushNotifications ? '#084C38' : '#94A3B8'}
            />
          </View>

          <View style={styles.menuDivider} />

          {/* Live FX Rate Alerts */}
          <View style={styles.menuItem}>
            <View style={[styles.menuIconBg, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="trending-up-outline" size={20} color="#D97706" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>Live Rate Alerts</Text>
              <Text style={styles.menuDesc}>Notify when NGN, GHS or KES peak</Text>
            </View>
            <Switch
              value={rateAlerts}
              onValueChange={setRateAlerts}
              trackColor={{ false: '#E2E8F0', true: '#A7F3D0' }}
              thumbColor={rateAlerts ? '#084C38' : '#94A3B8'}
            />
          </View>

          <View style={styles.menuDivider} />

          {/* SMS Receipts */}
          <View style={styles.menuItem}>
            <View style={[styles.menuIconBg, { backgroundColor: '#E6F6ED' }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={19} color="#084C38" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>SMS Receipts</Text>
              <Text style={styles.menuDesc}>Send payout confirmation to mobile</Text>
            </View>
            <Switch
              value={smsAlerts}
              onValueChange={setSmsAlerts}
              trackColor={{ false: '#E2E8F0', true: '#A7F3D0' }}
              thumbColor={smsAlerts ? '#084C38' : '#94A3B8'}
            />
          </View>
        </View>

        {/* Section 2: Security & Access */}
        <Text style={styles.sectionLabel}>SECURITY & ACCESS</Text>
        <View style={styles.menuCard}>
          {/* Biometrics */}
          <View style={styles.menuItem}>
            <View style={[styles.menuIconBg, { backgroundColor: '#E6F6ED' }]}>
              <Ionicons name="finger-print-outline" size={20} color="#084C38" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('biometricLogin') || 'Biometric Login'}</Text>
              <Text style={styles.menuDesc}>Unlock using Face ID / Touch ID</Text>
            </View>
            <Switch
              value={biometrics}
              onValueChange={setBiometrics}
              trackColor={{ false: '#E2E8F0', true: '#A7F3D0' }}
              thumbColor={biometrics ? '#084C38' : '#94A3B8'}
            />
          </View>

          <View style={styles.menuDivider} />

          {/* More Security Options */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation?.navigate && navigation.navigate('Security')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#FEE2E2' }]}>
              <MaterialIcons name="lock-outline" size={20} color="#DC2626" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>Security & Privacy Settings</Text>
              <Text style={styles.menuDesc}>Passcode, 2FA & Active Sessions</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Section 3: App Preferences */}
        <Text style={styles.sectionLabel}>APP PREFERENCES</Text>
        <View style={styles.menuCard}>
          {/* Language */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation?.navigate && navigation.navigate('Language')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#F3E8FF' }]}>
              <MaterialIcons name="language" size={20} color="#9333EA" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('language') || 'Language'}</Text>
              <Text style={styles.menuDesc}>English (US)</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Section 4: Support & Legal */}
        <Text style={styles.sectionLabel}>SUPPORT & LEGAL</Text>
        <View style={styles.menuCard}>
          {/* Help & Support */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation?.navigate && navigation.navigate('HelpSupport')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#ECFDF5' }]}>
              <Ionicons name="help-circle-outline" size={20} color="#059669" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('helpSupport') || 'Help & Support Center'}</Text>
              <Text style={styles.menuDesc}>FAQs, live chat and tickets</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          {/* Privacy Policy */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => Alert.alert('Privacy Policy', 'Opening AfriSend official privacy statement...')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#F1F5F9' }]}>
              <MaterialIcons name="description" size={20} color="#475569" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('privacyPolicy') || 'Privacy Policy'}</Text>
              <Text style={styles.menuDesc}>Terms of data protection & GDPR</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Regulatory Compliance Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerVersion}>AfriSend App Version 2.4.0 (Build 120)</Text>
          <Text style={styles.footerReg}>
            Licensed & Regulated by Qatar Central Bank (QCB)
          </Text>
        </View>
      </ScrollView>
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
    marginTop: 8,
  },
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    marginBottom: 18,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuIconBg: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  menuTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  menuDesc: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginLeft: 68,
  },
  footer: {
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 16,
  },
  footerVersion: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  footerReg: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
});
