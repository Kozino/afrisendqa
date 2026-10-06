import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
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
import { useAuth } from '../AuthContext';
import { useWallet } from '../WalletContext';

const GREEN = '#084C38';
const DARK_TEAL = '#083B2D';
const MINT = '#A7F3D0';
const GOLD = '#D97706';

export default function ProfileScreen({ navigation }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in ProfileScreen:', e);
  }

  const { customer: profile, signOut } = useAuth();
  const { transfers, balanceFormatted } = useWallet();

  const transferCount = (transfers || []).length;
  const totalSentMinor = (transfers || [])
    .filter((entry) => ['PAID', 'PROCESSING', 'INITIATED'].includes(entry.status))
    .reduce((sum, entry) => sum + Number(entry.totalDebitQarMinor || 0), 0);
  const totalSentFormatted = (totalSentMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const copyUserId = () => {
    const reference = profile?.reference || '';
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(reference);
      }
    } catch (e) {
      console.log('Clipboard error in ProfileScreen:', e);
    }
    Alert.alert('Copied', reference ? `Customer ID ${reference} copied.` : 'No customer ID yet.');
  };

  const handleLogout = () => {
    Alert.alert(
      t('logoutTitle') || 'Log Out',
      t('logoutConfirm') || 'Are you sure you want to log out of your AfriSend account?',
      [
        { text: t('cancel') || 'Cancel', style: 'cancel' },
        {
          text: t('logout') || 'Log Out',
          style: 'destructive',
          onPress: async () => {
            // Clears the refresh token server-side as well as on the device.
            await signOut();
            if (navigation?.replace) navigation.replace('Welcome');
          },
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
        <Text style={styles.headerTitle}>{t('profile') || 'Account Profile'}</Text>
        <TouchableOpacity
          onPress={() => navigation?.navigate && navigation.navigate('Settings')}
          style={styles.headerIconBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={20} color="#083B2D" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Profile Hero Section */}
        <View style={styles.profileHero}>
          {/* Avatar with Status Badge */}
          <View style={styles.avatarWrapper}>
            <View style={styles.avatarBorder}>
              <Image
                source={{
                  uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&auto=format&fit=crop&q=80',
                }}
                style={styles.avatarImage}
              />
            </View>
            <TouchableOpacity style={styles.cameraBadge} activeOpacity={0.8}>
              <Ionicons name="camera" size={13} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* User Details — from the signed-in session */}
          <Text style={styles.userName}>{profile?.fullName || 'Your profile'}</Text>
          <TouchableOpacity
            style={styles.userIdPill}
            onPress={copyUserId}
            activeOpacity={0.7}
          >
            <Text style={styles.userIdText}>ID: {profile?.reference || '—'}</Text>
            <Ionicons name="copy-outline" size={12} color="#084C38" style={{ marginLeft: 4 }} />
          </TouchableOpacity>

          {/* Verification & Tier Badges */}
          <View style={styles.badgeContainer}>
            <TouchableOpacity
              style={styles.verifiedBadge}
              onPress={() => navigation?.navigate && navigation.navigate('KYCVerification')}
              activeOpacity={0.7}
            >
              <Ionicons name="shield-checkmark" size={13} color="#084C38" />
              <Text style={styles.verifiedBadgeText}>
                {(profile?.kycTier ?? 0) >= 1 ? `Verified Tier ${profile.kycTier}` : 'Verification pending'}
              </Text>
            </TouchableOpacity>
            <View style={styles.goldBadge}>
              <MaterialCommunityIcons name="crown" size={14} color={GOLD} />
              <Text style={styles.goldBadgeText}>Gold Member</Text>
            </View>
          </View>
        </View>

        {/* Remittance Stats Summary Card */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalSentFormatted}</Text>
            <Text style={styles.statLabel}>Lifetime sent (QAR)</Text>
          </View>

          <View style={styles.statDivider} />

          <View style={styles.statItem}>
            <Text style={styles.statValue}>{transferCount}</Text>
            <Text style={styles.statLabel}>Corridors</Text>
          </View>

          <View style={styles.statDivider} />

          <View style={styles.statItem}>
            <Text style={styles.statValue}>100%</Text>
            <Text style={styles.statLabel}>Success Rate</Text>
          </View>
        </View>

        {/* Section 1: Account & Security */}
        <Text style={styles.sectionHeaderLabel}>
          {(t('accountAndSecurity') || 'ACCOUNT & SECURITY').toUpperCase()}
        </Text>
        <View style={styles.menuCard}>
          {/* Personal Info */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation?.navigate && navigation.navigate('PersonalInfo')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#E0F2FE' }]}>
              <MaterialIcons name="person-outline" size={20} color="#0284C7" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('personalInfo') || 'Personal Information'}</Text>
              <Text style={styles.menuDesc}>Name, Qatar ID, Phone Number</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          {/* Security */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation?.navigate && navigation.navigate('Security')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#FEE2E2' }]}>
              <MaterialIcons name="lock-outline" size={20} color="#DC2626" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('security') || 'Security & Biometrics'}</Text>
              <Text style={styles.menuDesc}>Passcode, Face ID, 2FA</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          {/* Linked Accounts */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation?.navigate && navigation.navigate('LinkedAccounts')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#E6F6ED' }]}>
              <Ionicons name="wallet-outline" size={20} color={GREEN} />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('linkedAccounts') || 'Linked Bank & Cards'}</Text>
              <Text style={styles.menuDesc}>QNB Bank, Visa Ending 4490</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          {/* KYC Verification Status (Corrected JSX) */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation?.navigate && navigation.navigate('KYCVerification')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#FEF3C7' }]}>
              <MaterialIcons name="verified-user" size={20} color="#D97706" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('kycVerification') || 'KYC Verification'}</Text>
              <Text style={styles.menuDesc}>Level 2 (Up to 50,000 QAR/mo)</Text>
            </View>
            <View style={styles.statusCompletedBadge}>
              <Text style={styles.statusCompletedText}>Approved</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>

        {/* Section 2: Preferences & Support */}
        <Text style={styles.sectionHeaderLabel}>
          {(t('preferences') || 'PREFERENCES & SUPPORT').toUpperCase()}
        </Text>
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
              <Text style={styles.menuTitle}>{t('language') || 'Language & Currency'}</Text>
              <Text style={styles.menuDesc}>English (US) • QAR (ر.ق)</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          {/* Live Support */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation?.navigate && navigation.navigate('HelpSupport')}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#ECFDF5' }]}>
              <Ionicons name="chatbubbles-outline" size={20} color="#059669" />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>{t('helpSupport') || 'Help & Support Center'}</Text>
              <Text style={styles.menuDesc}>Chat with remittance specialist</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Log Out Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <MaterialIcons name="logout" size={18} color="#DC2626" />
          <Text style={styles.logoutText}>{t('logout') || 'Log Out'}</Text>
        </TouchableOpacity>

        {/* Regulatory Compliance Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerVersion}>AfriSend Remit v2.4.0 (Build 120)</Text>
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
    paddingBottom: 36,
  },
  profileHero: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 28,
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 12,
  },
  avatarBorder: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    borderColor: GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: '#E6F6ED',
  },
  avatarImage: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  userName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#083B2D',
    letterSpacing: -0.3,
  },
  userIdPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 4,
  },
  userIdText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#084C38',
    fontFamily: 'monospace',
  },
  badgeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    gap: 5,
  },
  verifiedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#084C38',
  },
  goldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    gap: 5,
  },
  goldBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  statsCard: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    marginTop: -16,
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    shadowColor: '#084C38',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#083B2D',
  },
  statLabel: {
    color: '#64748B',
    fontSize: 11.5,
    marginTop: 2,
    fontWeight: '600',
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#E2E8F0',
  },
  sectionHeaderLabel: {
    color: '#64748B',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 24,
  },
  menuCard: {
    marginHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
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
  },
  menuTitle: {
    fontSize: 14.5,
    color: '#0F172A',
    fontWeight: '700',
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
  statusCompletedBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusCompletedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 24,
    paddingVertical: 15,
    backgroundColor: '#FEE2E2',
    borderRadius: 16,
    gap: 8,
  },
  logoutText: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    alignItems: 'center',
    marginTop: 22,
    paddingHorizontal: 20,
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
