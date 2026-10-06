import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { useAuth } from '../AuthContext';

export default function PersonalInfoScreen({ navigation }) {
  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in PersonalInfoScreen:', e);
  }

  /**
   * Prefilled from the customer record. The QID is shown masked — the full
   * number is encrypted at rest and never returned by the API.
   */
  const { customer, refresh: refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(customer?.fullName || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [qid, setQid] = useState(customer?.qidMasked || '');
  const [nationality, setNationality] = useState(customer?.nationality || '');
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      Alert.alert(
        t('success') || 'Profile Updated',
        t('profileUpdatedDesc') || 'Your personal details have been saved successfully.',
        [{ text: t('ok') || 'OK', onPress: () => navigation?.goBack && navigation.goBack() }]
      );
    }, 600);
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
        <Text style={styles.headerTitle}>{t('personalInfo') || 'Personal Information'}</Text>
        <View style={styles.kycHeaderBadge}>
          <Ionicons name="shield-checkmark" size={13} color="#084C38" />
          <Text style={styles.kycHeaderText}>KYC Level 2</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Regulatory Notice Banner */}
          <View style={styles.infoBanner}>
            <View style={styles.infoIconWrapper}>
              <MaterialCommunityIcons name="shield-lock-outline" size={20} color="#084C38" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBannerTitle}>Verified Legal Identity</Text>
              <Text style={styles.infoBannerText}>
                Your identity data is verified against Qatar Central Bank regulatory databases. Locked fields require support review to update.
              </Text>
            </View>
          </View>

          {/* Section: Legal Identity */}
          <Text style={styles.sectionLabel}>LEGAL IDENTITY</Text>
          <View style={styles.formCard}>
            {/* Full Legal Name */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>{t('fullName') || 'Full Legal Name'}</Text>
                <View style={styles.verifiedFieldBadge}>
                  <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                  <Text style={styles.verifiedFieldText}>QID Matched</Text>
                </View>
              </View>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={18} color="#084C38" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Full Name"
                />
              </View>
            </View>

            <View style={styles.divider} />

            {/* Qatar ID (QID) */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Qatar ID Number (QID)</Text>
                <View style={styles.verifiedFieldBadge}>
                  <Ionicons name="lock-closed" size={11} color="#64748B" />
                  <Text style={[styles.verifiedFieldText, { color: '#64748B' }]}>Verified</Text>
                </View>
              </View>
              <View style={[styles.inputWrapper, styles.inputWrapperDisabled]}>
                <Ionicons name="card-outline" size={18} color="#64748B" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, styles.inputDisabled]}
                  value={qid}
                  editable={false}
                />
              </View>
            </View>

            <View style={styles.divider} />

            {/* Date of Birth & Nationality Row */}
            <View style={styles.row}>
              {/* DOB */}
              <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                <Text style={styles.label}>Date of Birth</Text>
                <View style={[styles.inputWrapper, styles.inputWrapperDisabled]}>
                  <Ionicons name="calendar-outline" size={17} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, styles.inputDisabled]}
                    value={dob}
                    editable={false}
                  />
                </View>
              </View>

              {/* Nationality */}
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.label}>Nationality</Text>
                <View style={[styles.inputWrapper, styles.inputWrapperDisabled]}>
                  <Text style={styles.flagEmoji}>🇳🇬</Text>
                  <TextInput
                    style={[styles.input, styles.inputDisabled]}
                    value={nationality}
                    editable={false}
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Section: Contact & Location Details */}
          <Text style={styles.sectionLabel}>CONTACT & RESIDENTIAL DETAILS</Text>
          <View style={styles.formCard}>
            {/* Email Address */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>{t('email') || 'Email Address'}</Text>
                <View style={styles.verifiedFieldBadge}>
                  <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                  <Text style={styles.verifiedFieldText}>Verified</Text>
                </View>
              </View>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={18} color="#084C38" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.divider} />

            {/* Phone Number */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>{t('phoneNumber') || 'Mobile Number'}</Text>
                <View style={styles.verifiedFieldBadge}>
                  <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                  <Text style={styles.verifiedFieldText}>Primary</Text>
                </View>
              </View>
              <View style={styles.inputWrapper}>
                <Text style={styles.flagEmoji}>🇶🇦</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <View style={styles.divider} />

            {/* Residential Address in Qatar */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('residentialAddress') || 'Residential Address (Qatar)'}</Text>
              <View style={[styles.inputWrapper, { height: 'auto', paddingVertical: 12 }]}>
                <Ionicons name="location-outline" size={19} color="#084C38" style={[styles.inputIcon, { marginTop: 2 }]} />
                <TextInput
                  style={[styles.input, { minHeight: 44 }]}
                  value={address}
                  onChangeText={setAddress}
                  multiline
                  numberOfLines={2}
                />
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Footer Action Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSave}
            disabled={isSaving}
            activeOpacity={0.85}
          >
            <Text style={styles.saveBtnText}>
              {isSaving ? 'Saving Changes...' : t('saveChanges') || 'Save Changes'}
            </Text>
            <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  kycHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  kycHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#084C38',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    gap: 12,
  },
  infoIconWrapper: {
    marginTop: 2,
  },
  infoBannerTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 2,
  },
  infoBannerText: {
    fontSize: 12,
    color: '#065F46',
    lineHeight: 17,
    fontWeight: '500',
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  formCard: {
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
  inputGroup: {
    marginVertical: 4,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#083B2D',
    marginBottom: 6,
  },
  verifiedFieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  verifiedFieldText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#065F46',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 50,
  },
  inputWrapperDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#EDF2F7',
  },
  inputIcon: {
    marginRight: 10,
  },
  flagEmoji: {
    fontSize: 18,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    color: '#0F172A',
    paddingVertical: 0,
  },
  inputDisabled: {
    color: '#64748B',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 10,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  saveBtn: {
    backgroundColor: '#084C38',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
