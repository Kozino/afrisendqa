import * as React from 'react';
import { View, ActivityIndicator, StyleSheet, Text, StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Contexts
import { AuthProvider, useAuth } from './AuthContext';
import { WalletProvider } from './WalletContext';
import { LanguageProvider } from './LanguageContext';

// 1. Onboarding & authentication
import WelcomeScreen from './screens/WelcomeScreen';
import LoginScreen from './screens/LoginScreen';
import LoginOtpScreen from './screens/LoginOtpScreen';
import CreateAccountScreen from './screens/CreateAccountScreen';

// 2. Identity & KYC
import KYCVerificationScreen from './screens/KYCVerificationScreen';
import VerifyIdentityScreen from './screens/VerifyIdentityScreen';
import ScanIDScreen from './screens/ScanIDScreen';
import VerificationFailedScreen from './screens/VerificationFailedScreen';
import SuccessScreen from './screens/SuccessScreen';

// 3. Dashboard
import DashboardScreen from './screens/DashboardScreen';
import NotificationsScreen from './screens/NotificationsScreen';

// 4. Wallet funding
import FundWalletScreen from './screens/FundWalletScreen';
import AddCardScreen from './screens/AddCardScreen';
import FundViaBankScreen from './screens/FundViaBankScreen';
import OtpScreen from './screens/OtpScreen';
import FundSuccessScreen from './screens/FundSuccessScreen';

// 5. Remittance
import SendMoneyScreen from './screens/SendMoneyScreen';
import TransferMethodScreen from './screens/TransferMethodScreen';
import ReviewTransferScreen from './screens/ReviewTransferScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import TransferSuccessScreen from './screens/TransferSuccessScreen';
import TransactionDetailsScreen from './screens/TransactionDetailsScreen';
import ActivityHistoryScreen from './screens/ActivityHistoryScreen';

// 6. Beneficiaries
import RecipientsScreen from './screens/RecipientsScreen';
import AddBeneficiaryScreen from './screens/AddBeneficiaryScreen';
import EditBeneficiaryScreen from './screens/EditBeneficiaryScreen';

// 7. Profile, security & preferences
import ProfileScreen from './screens/ProfileScreen';
import PersonalInfoScreen from './screens/PersonalInfoScreen';
import SecurityScreen from './screens/SecurityScreen';
import LinkedAccountsScreen from './screens/LinkedAccountsScreen';
import LanguageScreen from './screens/LanguageScreen';
import SettingsScreen from './screens/SettingsScreen';
import HelpSupportScreen from './screens/HelpSupportScreen';

const Stack = createNativeStackNavigator();

function Splash() {
  return (
    <View style={styles.splash}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.splashMark}>AfriSend</Text>
      <ActivityIndicator color="#A7F3D0" style={{ marginTop: 14 }} />
    </View>
  );
}

/**
 * Navigation shell.
 *
 * Signed-in customers land on the dashboard; everyone else starts at Welcome.
 * The signed-in stack still includes the auth screens so signing out mid-flow
 * cannot leave a dead end.
 */
function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') return <Splash />;

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={status === 'signedIn' ? 'Dashboard' : 'Welcome'}
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        {/* Onboarding & authentication */}
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="LoginOtp" component={LoginOtpScreen} />
        <Stack.Screen name="CreateAccount" component={CreateAccountScreen} />

        {/* Identity verification */}
        <Stack.Screen name="KYCVerification" component={KYCVerificationScreen} />
        <Stack.Screen name="VerifyIdentity" component={VerifyIdentityScreen} />
        <Stack.Screen name="ScanID" component={ScanIDScreen} />
        <Stack.Screen name="VerificationFailed" component={VerificationFailedScreen} />
        <Stack.Screen name="Success" component={SuccessScreen} />

        {/* Dashboard */}
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />

        {/* Wallet funding */}
        <Stack.Screen name="FundWallet" component={FundWalletScreen} />
        <Stack.Screen name="AddCard" component={AddCardScreen} />
        <Stack.Screen name="FundViaBank" component={FundViaBankScreen} />
        <Stack.Screen name="Otp" component={OtpScreen} />
        <Stack.Screen name="FundSuccess" component={FundSuccessScreen} />

        {/* Remittance */}
        <Stack.Screen name="SendMoney" component={SendMoneyScreen} />
        <Stack.Screen name="TransferMethod" component={TransferMethodScreen} />
        <Stack.Screen name="ReviewTransfer" component={ReviewTransferScreen} />
        <Stack.Screen name="Processing" component={ProcessingScreen} />
        <Stack.Screen name="TransferSuccess" component={TransferSuccessScreen} />
        <Stack.Screen name="TransactionDetails" component={TransactionDetailsScreen} />
        <Stack.Screen name="ActivityHistory" component={ActivityHistoryScreen} />

        {/* Beneficiaries */}
        <Stack.Screen name="Recipients" component={RecipientsScreen} />
        <Stack.Screen name="AddBeneficiary" component={AddBeneficiaryScreen} />
        <Stack.Screen name="EditBeneficiary" component={EditBeneficiaryScreen} />

        {/* Profile & settings */}
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="PersonalInfo" component={PersonalInfoScreen} />
        <Stack.Screen name="Security" component={SecurityScreen} />
        <Stack.Screen name="LinkedAccounts" component={LinkedAccountsScreen} />
        <Stack.Screen name="Language" component={LanguageScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <WalletProvider>
          <LanguageProvider>
            <RootNavigator />
          </LanguageProvider>
        </WalletProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#083B2D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashMark: {
    color: '#A7F3D0',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
});
