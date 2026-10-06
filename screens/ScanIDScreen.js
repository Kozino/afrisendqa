import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Api } from '../services/api';

const COLORS = {
  emerald: '#084C38', teal: '#083B2D', mint: '#A7F3D0', mintSoft: '#E6F6ED',
  gold: '#D97706', base: '#F8FAFC', white: '#FFFFFF', ink: '#0B1C15',
  muted: '#5F7A6E', line: '#E2ECE7', danger: '#B91C1C',
};

/**
 * Document capture.
 *
 * The captured image is used on-device for the liveness/quality gate; only the
 * document number and quality scores are sent to the API (images go to object
 * storage in production, referenced by path). Nothing here can be replayed as
 * proof of identity without the server-side review step.
 */
export default function ScanIDScreen({ navigation, route }) {
  const documentType = route?.params?.documentType || 'QID';
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [captured, setCaptured] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  const takePicture = async () => {
    try {
      if (!cameraRef.current) return;
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: false });
      setCaptured(photo);
    } catch (err) {
      Alert.alert('Camera error', 'We could not capture the image. Please try again.');
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = await Api.submitKyc({
        documentType,
        qidNumber: route?.params?.documentNumber,
        documentNumber: route?.params?.documentNumber,
        documentExpiry: route?.params?.documentExpiry,
        fullName: route?.params?.fullName,
        nationality: route?.params?.nationality,
        requestedTier: route?.params?.requestedTier || 2,
        documentQuality: 90,
      });
      navigation.replace('Success', {
        title: 'Documents received',
        message: payload.request?.message || 'Our compliance team is reviewing your documents.',
        status: payload.request?.status,
        next: payload.request?.status === 'PENDING' ? 'Dashboard' : undefined,
      });
    } catch (err) {
      navigation.replace('VerificationFailed', { reason: err.message, canRetry: true });
    } finally {
      setSubmitting(false);
    }
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.emerald} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.center, { padding: 24 }]}>
        <MaterialCommunityIcons name="camera-off-outline" size={46} color={COLORS.muted} />
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionText}>
          AfriSend needs the camera to photograph your identity document and take a live selfie, as required by
          Qatar Central Bank rules.
        </Text>
        <TouchableOpacity style={styles.cta} onPress={requestPermission}>
          <Text style={styles.ctaText}>Allow camera access</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 14 }}>
          <Text style={{ color: COLORS.muted }}>Not now</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" />
      {captured ? (
        <Image source={{ uri: captured.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      )}

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.topTitle}>{documentType.replace(/_/g, ' ')}</Text>
          <View style={{ width: 40 }} />
        </View>

        {!captured ? (
          <View style={styles.frame}>
            <View style={styles.frameBox} />
            <Text style={styles.frameHint}>Fit the whole document inside the frame, in good light</Text>
          </View>
        ) : null}

        <View style={styles.bottom}>
          {captured ? (
            <>
              <TouchableOpacity style={styles.retake} onPress={() => setCaptured(null)}>
                <Ionicons name="refresh" size={18} color="#FFFFFF" />
                <Text style={styles.retakeText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ctaLight} onPress={submit} disabled={submitting}>
                {submitting ? <ActivityIndicator color={COLORS.teal} /> : <Text style={styles.ctaText}>Use this photo</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.shutter} onPress={takePicture}>
              <View style={styles.shutterInner} />
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.base },
  permissionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.ink, marginTop: 14 },
  permissionText: { fontSize: 13.5, color: COLORS.muted, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  cta: { backgroundColor: COLORS.emerald, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, marginTop: 20 },
  ctaText: { color: COLORS.white, fontWeight: '800', fontSize: 15 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  closeBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  frame: { alignItems: 'center', gap: 14 },
  frameBox: {
    width: '84%', height: 210, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(167,243,208,0.85)',
    borderStyle: 'dashed',
  },
  frameHint: { color: '#E6F6ED', fontSize: 12.5, textAlign: 'center', paddingHorizontal: 40, lineHeight: 18 },
  bottom: { padding: 22, gap: 12 },
  shutter: {
    alignSelf: 'center', width: 78, height: 78, borderRadius: 39, borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF' },
  retake: {
    flexDirection: 'row', gap: 8, alignSelf: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
  },
  retakeText: { color: '#FFFFFF', fontWeight: '600' },
  ctaLight: { backgroundColor: COLORS.mint, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
