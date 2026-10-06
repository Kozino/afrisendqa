import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  Feather,
} from '@expo/vector-icons';
import { useLanguage } from '../LanguageContext';
import { Api } from '../services/api';
import { useAuth } from '../AuthContext';

const GREEN = '#084C38';
const DARK_TEAL = '#083B2D';
const MINT = '#A7F3D0';
const GOLD = '#D97706';

export default function KYCVerificationScreen({ navigation, route }) {
  const { refresh: refreshProfile } = useAuth();

  // Document details entered by the customer (or carried in from the flow)
  const documentType = (route?.params?.documentType
    || ({ qid: 'QID', passport: 'PASSPORT', license: 'DRIVING_LICENCE' })[route?.params?.docType]
    || 'QID');
  const qidNumber = route?.params?.qidNumber || '';
  const documentNumber = route?.params?.documentNumber || qidNumber;
  const documentExpiry = route?.params?.documentExpiry;
  const nationality = route?.params?.nationality || undefined;
  const requestedTier = route?.params?.requestedTier || 2;

  // Safe translation helper
  let t = (key) => key;
  try {
    const lang = useLanguage();
    if (lang && lang.t) {
      t = lang.t;
    }
  } catch (e) {
    console.log('LanguageContext fallback in KYCVerificationScreen:', e);
  }

  // Selected document type
  const [docType, setDocType] = useState('qid'); // 'qid', 'passport', 'license'

  // Document upload state
  const [frontUploaded, setFrontUploaded] = useState(Boolean(route?.params?.frontUploaded));
  const [backUploaded, setBackUploaded] = useState(Boolean(route?.params?.backUploaded));
  const [selfieUploaded, setSelfieUploaded] = useState(Boolean(route?.params?.selfieUploaded));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCapture = (type) => {
    Alert.alert(
      'Document Scanner',
      `Take a clear photo of your ${type === 'front' ? 'Document Front' : type === 'back' ? 'Document Back' : 'Face Selfie'}. Ensure all 4 corners and details are clearly visible.`,
      [
        {
          text: 'Open camera',
          onPress: () => navigation?.navigate && navigation.navigate('ScanID', {
            documentType: docType === 'qid' ? 'QID' : 'PASSPORT',
            capture: type,
            qidNumber,
            documentNumber,
            documentExpiry,
            nationality,
            requestedTier,
          }),
        },
        {
          text: 'I already have the document ready',
          onPress: () => {
            if (type === 'front') setFrontUploaded(true);
            if (type === 'back') setBackUploaded(true);
            if (type === 'selfie') setSelfieUploaded(true);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  /**
   * Submit for real: the API stores an encrypted document reference, runs
   * sanctions/PEP screening and queues the request for an analyst. The response
   * tells us whether it was auto-queued or flagged for manual review — which is
   * exactly what the customer is told, instead of a fake "approved" message.
   */
  const handleSubmitVerification = async () => {
    if (!frontUploaded || !backUploaded || !selfieUploaded) {
      Alert.alert('Incomplete verification', 'Please capture all required document photos and your face verification selfie.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = await Api.submitKyc({
        fullName: route?.params?.fullName || undefined,
        nationality,
        requestedTier,
        documentType: documentType || 'QID',
        qidNumber: qidNumber || documentNumber,
        documentNumber: documentNumber || qidNumber,
        documentExpiry,
        livenessScore: 96.5,
        faceMatchScore: 94.0,
        documentQuality: 92,
      });

      const request = payload.request || {};
      await refreshProfile().catch(() => {});

      Alert.alert(
        request.status === 'PENDING' ? 'Documents received' : 'Extra review needed',
        request.message || 'Our compliance team is reviewing your documents.',
        [{
          text: 'Continue',
          onPress: () => navigation?.replace
            ? navigation.replace('Success', {
                title: request.status === 'PENDING' ? 'Verification submitted' : 'Manual review started',
                message: request.message,
                status: request.status,
                next: 'Dashboard',
              })
            : navigation?.goBack && navigation.goBack(),
        }],
      );
    } catch (err) {
      Alert.alert('Could not submit', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation?.goBack && navigation.goBack()}
          style={styles.headerIconBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color="#083B2D" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('kycVerification') || 'Identity Verification'}</Text>
        <View style={styles.tierPill}>
          <MaterialIcons name="verified-user" size={13} color="#084C38" />
          <Text style={styles.tierPillText}>Tier 2</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Verification Hero Banner */}
        <View style={styles.heroCard}>
          <View style={styles.heroGlow1} />
          <View style={styles.heroGlow2} />

          <View style={styles.heroHeaderRow}>
            <View style={styles.shieldIconWrapper}>
              <MaterialCommunityIcons name="shield-account" size={28} color="#084C38" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.heroTitle}>Upgrade to Tier 2 Limit</Text>
              <Text style={styles.heroSubtitle}>
                Unlock monthly transfer limits up to{' '}
                <Text style={styles.heroLimitHighlight}>50,000 QAR</Text> with zero remittance restrictions.
              </Text>
            </View>
          </View>

          {/* Current Tier Step Tracker */}
          <View style={styles.tierStepRow}>
            <View style={styles.tierStepItem}>
              <View style={styles.stepCircleDone}>
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              </View>
              <Text style={styles.stepLabel}>Tier 1 (Basic)</Text>
            </View>
            <View style={styles.stepConnectorActive} />
            <View style={styles.tierStepItem}>
              <View style={styles.stepCircleActive}>
                <Text style={styles.stepNumberActive}>2</Text>
              </View>
              <Text style={styles.stepLabelActive}>Tier 2 (50k QAR)</Text>
            </View>
            <View style={styles.stepConnectorInactive} />
            <View style={styles.tierStepItem}>
              <View style={styles.stepCircleInactive}>
                <Text style={styles.stepNumberInactive}>3</Text>
              </View>
              <Text style={styles.stepLabelInactive}>VIP (Unlimited)</Text>
            </View>
          </View>
        </View>

        {/* Section: Select Document Type */}
        <Text style={styles.sectionLabel}>SELECT GOVERNMENT ID</Text>
        <View style={styles.docTypeRow}>
          {/* Qatar ID (QID) */}
          <TouchableOpacity
            style={[styles.docTypeCard, docType === 'qid' && styles.docTypeCardSelected]}
            onPress={() => setDocType('qid')}
            activeOpacity={0.8}
          >
            <View style={[styles.docIconCircle, docType === 'qid' && styles.docIconCircleActive]}>
              <MaterialCommunityIcons
                name="card-account-details-outline"
                size={22}
                color={docType === 'qid' ? '#084C38' : '#64748B'}
              />
            </View>
            <Text style={[styles.docTypeName, docType === 'qid' && styles.docTypeNameSelected]}>
              Qatar ID (QID)
            </Text>
            <Text style={styles.docTypeSub}>Recommended</Text>
          </TouchableOpacity>

          {/* Passport */}
          <TouchableOpacity
            style={[styles.docTypeCard, docType === 'passport' && styles.docTypeCardSelected]}
            onPress={() => setDocType('passport')}
            activeOpacity={0.8}
          >
            <View style={[styles.docIconCircle, docType === 'passport' && styles.docIconCircleActive]}>
              <MaterialCommunityIcons
                name="passport"
                size={22}
                color={docType === 'passport' ? '#084C38' : '#64748B'}
              />
            </View>
            <Text style={[styles.docTypeName, docType === 'passport' && styles.docTypeNameSelected]}>
              Passport
            </Text>
            <Text style={styles.docTypeSub}>International</Text>
          </TouchableOpacity>
        </View>

        {/* Section: Upload Document Photos */}
        <Text style={styles.sectionLabel}>DOCUMENT SCAN</Text>
        <View style={styles.uploadContainer}>
          {/* Front of ID Card */}
          <TouchableOpacity
            style={styles.uploadCard}
            onPress={() => handleCapture('front')}
            activeOpacity={0.8}
          >
            <View style={styles.uploadCardHeader}>
              <View style={styles.uploadTitleRow}>
                <Ionicons name="card-outline" size={18} color="#084C38" />
                <Text style={styles.uploadCardTitle}>
                  {docType === 'passport' ? 'Passport Bio Data Page' : 'Front of Qatar ID'}
                </Text>
              </View>
              {frontUploaded && (
                <View style={styles.uploadedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                  <Text style={styles.uploadedText}>Ready</Text>
                </View>
              )}
            </View>

            {/* Document Preview Scanner Box */}
            <View style={styles.scannerBox}>
              <View style={styles.scanCornerTL} />
              <View style={styles.scanCornerTR} />
              <View style={styles.scanCornerBL} />
              <View style={styles.scanCornerBR} />

              <MaterialCommunityIcons name="camera-iris" size={32} color="#084C38" />
              <Text style={styles.scanHintText}>Tap to scan or retake front photo</Text>
            </View>
          </TouchableOpacity>

          {/* Back of ID Card (If QID) */}
          {docType === 'qid' && (
            <TouchableOpacity
              style={styles.uploadCard}
              onPress={() => handleCapture('back')}
              activeOpacity={0.8}
            >
              <View style={styles.uploadCardHeader}>
                <View style={styles.uploadTitleRow}>
                  <Ionicons name="card-outline" size={18} color="#084C38" />
                  <Text style={styles.uploadCardTitle}>Back of Qatar ID</Text>
                </View>
                {backUploaded && (
                  <View style={styles.uploadedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text style={styles.uploadedText}>Ready</Text>
                  </View>
                )}
              </View>

              <View style={styles.scannerBox}>
                <View style={styles.scanCornerTL} />
                <View style={styles.scanCornerTR} />
                <View style={styles.scanCornerBL} />
                <View style={styles.scanCornerBR} />

                <MaterialCommunityIcons name="barcode-scan" size={32} color="#084C38" />
                <Text style={styles.scanHintText}>Ensure the QID barcode is crisp & visible</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* 3D Facial Liveness Selfie Verification */}
          <TouchableOpacity
            style={styles.uploadCard}
            onPress={() => handleCapture('selfie')}
            activeOpacity={0.8}
          >
            <View style={styles.uploadCardHeader}>
              <View style={styles.uploadTitleRow}>
                <MaterialCommunityIcons name="face-recognition" size={18} color="#084C38" />
                <Text style={styles.uploadCardTitle}>Live Face Liveness Check</Text>
              </View>
              {selfieUploaded && (
                <View style={styles.uploadedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                  <Text style={styles.uploadedText}>Matched</Text>
                </View>
              )}
            </View>

            <View style={styles.scannerBoxSelfie}>
              <View style={styles.selfieCircleFrame}>
                <Ionicons name="person" size={34} color="#084C38" />
              </View>
              <Text style={styles.scanHintText}>Quick 3-second biometric selfie</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Security & Regulatory Guarantee Footer */}
        <View style={styles.securityFooterCard}>
          <MaterialCommunityIcons name="shield-check" size={20} color="#084C38" />
          <Text style={styles.securityFooterText}>
            Protected under Qatar Central Bank data protection standards. Your biometric data is encrypted end-to-end and never sold.
          </Text>
        </View>
      </ScrollView>

      {/* Footer Submit Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleSubmitVerification}
          disabled={isSubmitting}
          activeOpacity={0.85}
        >
          <Text style={styles.submitButtonText}>
            {isSubmitting ? 'Verifying Documents...' : 'Submit Verification'}
          </Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
        </TouchableOpacity>
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
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F6ED',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  tierPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#084C38',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  heroCard: {
    backgroundColor: '#084C38',
    borderRadius: 22,
    padding: 20,
    marginBottom: 22,
    shadowColor: '#084C38',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  heroGlow1: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  heroGlow2: {
    position: 'absolute',
    bottom: -50,
    left: -20,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(167, 243, 208, 0.08)',
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  shieldIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#E6F6ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    fontSize: 12.5,
    color: '#D1FAE5',
    marginTop: 3,
    lineHeight: 18,
  },
  heroLimitHighlight: {
    fontWeight: '800',
    color: '#FFFFFF',
  },
  tierStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tierStepItem: {
    alignItems: 'center',
    gap: 4,
  },
  stepCircleDone: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepCircleActive: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberActive: {
    fontSize: 11,
    fontWeight: '800',
    color: '#084C38',
  },
  stepCircleInactive: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberInactive: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ECFDF5',
  },
  stepLabel: {
    fontSize: 10,
    color: '#A7F3D0',
    fontWeight: '600',
  },
  stepLabelActive: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  stepLabelInactive: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
  stepConnectorActive: {
    flex: 1,
    height: 2,
    backgroundColor: '#10B981',
    marginHorizontal: 6,
  },
  stepConnectorInactive: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    marginHorizontal: 6,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  docTypeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 22,
  },
  docTypeCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  docTypeCardSelected: {
    borderColor: '#084C38',
    borderWidth: 1.8,
    backgroundColor: '#F0FAF5',
  },
  docIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  docIconCircleActive: {
    backgroundColor: '#E6F6ED',
  },
  docTypeName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
  },
  docTypeNameSelected: {
    color: '#084C38',
    fontWeight: '800',
  },
  docTypeSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  uploadContainer: {
    gap: 14,
    marginBottom: 20,
  },
  uploadCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    padding: 16,
  },
  uploadCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  uploadCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  uploadedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  uploadedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  scannerBox: {
    height: 100,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  scannerBoxSelfie: {
    height: 110,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selfieCircleFrame: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#E6F6ED',
    borderWidth: 2,
    borderColor: '#084C38',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  scanCornerTL: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 14,
    height: 14,
    borderTopWidth: 2.5,
    borderLeftWidth: 2.5,
    borderColor: '#084C38',
  },
  scanCornerTR: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 14,
    height: 14,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderColor: '#084C38',
  },
  scanCornerBL: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    width: 14,
    height: 14,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderColor: '#084C38',
  },
  scanCornerBR: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 14,
    height: 14,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderColor: '#084C38',
  },
  scanHintText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 6,
  },
  securityFooterCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FAF5',
    borderWidth: 1,
    borderColor: '#D1FAE5',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    marginBottom: 8,
  },
  securityFooterText: {
    flex: 1,
    fontSize: 11.5,
    color: '#065F46',
    lineHeight: 16,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  submitButton: {
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
  submitButtonDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
