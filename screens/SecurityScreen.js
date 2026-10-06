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
  MaterialCommunityIcons,
} from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';

export default function SecurityScreen({ navigation }) {
  // Translation hook
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in SecurityScreen:', e);
  }

  const [biometrics, setBiometrics] = useState(true);
  const [twoFA, setTwoFA] = useState(true);
  const [hideBalanceOnLaunch, setHideBalanceOnLaunch] = useState(false);

  const handleFreezeAccount = () => {
    Alert.alert(
      'Emergency Account Freeze',
      'Temporarily locking your account will block all outgoing remittances and card top-ups immediately until you verify your identity with support.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Freeze Account',
          style: 'destructive',
          onPress: () => Alert.alert('Account Locked', 'Your account has been temporarily secured.'),
        },
      ]
    );
  };

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
        <Text style={styles.headerTitle}>{t('security') || 'Security & Privacy'}</Text>
        <View style={styles.sslBadge}>
          <Ionicons name="shield-checkmark" size={13} color="#084C38" />
          <Text style={styles.sslText}>256-Bit SSL</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Security Shield Score Card */}
        <View style={styles.securityScoreCard}>
          <View style={styles.scoreTopRow}>
            <View style={styles.shieldIconCircle}>
              <MaterialCommunityIcons name="shield-check" size={26} color="#084C38" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.scoreTitle}>Security Status: Strong</Text>
              <Text style={styles.scoreDesc}>Your account is protected with bank-grade multi-factor security.</Text>
            </View>
          </View>
          {/* Progress Indicator */}
          <View style={styles.scoreBarBg}>
            <View style={styles.scoreBarFill} />
          </View>
        </View>

        {/* Section 1: Authentication & Access */}
        <Text style={styles.sectionLabel}>AUTHENTICATION & ACCESS</Text>
        <View style={styles.menuCard}>
          {/* Biometric Login (Face ID / Fingerprint) */}
          <View style={styles.menuItem}>
            <View style={[styles.menuIconBg, { backgroundColor: '#E6F6ED' }]}>
              <Ionicons name="finger-print-outline" size={20} color="#084C38" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('biometricLogin') || 'Biometric Authentication'}</Text>
              <Text style={styles.menuDesc}>Face ID / Touch ID quick login</Text>
            </View>
            <Switch
              value={biometrics}
              onValueChange={setBiometrics}
              trackColor={{ false: '#E2E8F0', true: '#A7F3D0' }}
              thumbColor={biometrics ? '#084C38' : '#94A3B8'}
            />
          </View>

          <View style={styles.menuDivider} />

          {/* Two-Factor Authentication (2FA) */}
          <View style={styles.menuItem}>
            <View style={[styles.menuIconBg, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#D97706" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('twoFactorAuth') || 'Two-Factor Authentication'}</Text>
              <Text style={styles.menuDesc}>Require SMS OTP on new logins</Text>
            </View>
            <Switch
              value={twoFA}
              onValueChange={setTwoFA}
              trackColor={{ false: '#E2E8F0', true: '#A7F3D0' }}
              thumbColor={twoFA ? '#084C38' : '#94A3B8'}
            />
          </View>

          <View style={styles.menuDivider} />

          {/* Change 6-Digit Transaction PIN */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => Alert.alert('Transaction PIN', 'Opening 6-digit transaction PIN update...')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#E0F2FE' }]}>
              <MaterialCommunityIcons name="form-textbox-password" size={20} color="#0284C7" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>Transaction PIN</Text>
              <Text style={styles.menuDesc}>Required for remittances over 500 QAR</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          {/* Change Account Password */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => Alert.alert('Change Password', 'Opening password reset flow...')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#F3E8FF' }]}>
              <Ionicons name="key-outline" size={19} color="#9333EA" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('changePassword') || 'Change Password'}</Text>
              <Text style={styles.menuDesc}>Last changed 3 months ago</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Section 2: Privacy & Controls */}
        <Text style={styles.sectionLabel}>PRIVACY & SESSIONS</Text>
        <View style={styles.menuCard}>
          {/* Hide Balance in Public Mode */}
          <View style={styles.menuItem}>
            <View style={[styles.menuIconBg, { backgroundColor: '#F8FAFC' }]}>
              <Ionicons name="eye-off-outline" size={20} color="#475569" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>Privacy Mode</Text>
              <Text style={styles.menuDesc}>Mask wallet balance in public</Text>
            </View>
            <Switch
              value={hideBalanceOnLaunch}
              onValueChange={setHideBalanceOnLaunch}
              trackColor={{ false: '#E2E8F0', true: '#A7F3D0' }}
              thumbColor={hideBalanceOnLaunch ? '#084C38' : '#94A3B8'}
            />
          </View>

          <View style={styles.menuDivider} />

          {/* Active Devices & Sessions */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => Alert.alert('Active Devices', 'iPhone 15 Pro • Doha, Qatar (Current Device)')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#E0F2FE' }]}>
              <Ionicons name="phone-portrait-outline" size={19} color="#0284C7" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>Active Devices & Sessions</Text>
              <Text style={styles.menuDesc}>1 active device • Doha, QA</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Emergency Lock Account Button */}
        <TouchableOpacity
          style={styles.freezeBtn}
          onPress={handleFreezeAccount}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="snowflake-alert" size={19} color="#DC2626" />
          <Text style={styles.freezeBtnText}>Emergency Account Freeze</Text>
        </TouchableOpacity>

        {/* Security Compliance Note */}
        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Protected by end-to-end encryption complying with Qatar Central Bank cybersecurity guidelines.
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
  sslBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  sslText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#084C38',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  securityScoreCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 20,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  scoreTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  shieldIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#083B2D',
  },
  scoreDesc: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16,
  },
  scoreBarBg: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  scoreBarFill: {
    width: '90%',
    height: '100%',
    backgroundColor: '#084C38',
    borderRadius: 3,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    marginBottom: 20,
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
  freezeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    backgroundColor: '#FEE2E2',
    borderRadius: 16,
    gap: 8,
    marginTop: 4,
    marginBottom: 16,
  },
  freezeBtnText: {
    color: '#DC2626',
    fontSize: 14.5,
    fontWeight: '700',
  },
  footerNote: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  footerNoteText: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 16,
  },
});
