import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Alert,
  TextInput,
  ScrollView,
} from "react-native";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  arrayUnion,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "../firebase/firebaseConfig";
import QRCode from "react-native-qrcode-svg";
import * as Crypto from "expo-crypto";

export default function HomeScreen({ onLogout }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [qrValue, setQrValue] = useState("");
  const [registering, setRegistering] = useState(false);
  const [myRegistrations, setMyRegistrations] = useState([]);
  const [showMyEvents, setShowMyEvents] = useState(false);

  // Registration Form Fields
  const [formData, setFormData] = useState({
    fullName: "",
    studentId: "",
    phone: "",
    department: "",
    year: "",
  });

  // Fetch events with real-time updates
  useEffect(() => {
    const q = query(collection(db, "events"), orderBy("createdAt", "desc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setEvents(list);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Fetch user's registrations
  useEffect(() => {
    if (!auth.currentUser) return;

    const userId = auth.currentUser.uid;
    const registrationsRef = collection(db, "registrations");
    
    const unsubscribe = onSnapshot(
      registrationsRef,
      (snapshot) => {
        const myRegs = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((reg) => reg.userId === userId && reg.status === "confirmed");
        setMyRegistrations(myRegs);
      },
      (error) => {
        console.error("Error fetching registrations:", error);
        setMyRegistrations([]);
      }
    );

    return unsubscribe;
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    onLogout();
  };

  const isRegisteredForEvent = (eventId) => {
    return myRegistrations.some((reg) => reg.eventId === eventId);
  };

  // Generate unique verification code
  const generateVerificationCode = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  };

  // Generate unique secure token for QR code
  const generateUniqueToken = async () => {
    const randomBytes = await Crypto.getRandomBytesAsync(16);
    return Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  };

  const openRegistrationForm = (event) => {
    // Check if already registered
    if (isRegisteredForEvent(event.id)) {
      Alert.alert(
        "Already Registered",
        "You are already registered for this event. Would you like to view your QR code?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "View QR Code",
            onPress: () => viewExistingRegistration(event),
          },
        ]
      );
      return;
    }

    // Check capacity
    if (
      event.maxParticipants &&
      event.registeredUsers?.length >= event.maxParticipants
    ) {
      Alert.alert("Event Full", "This event has reached maximum capacity.");
      return;
    }

    setSelectedEvent(event);
    setShowRegistrationForm(true);
  };

  const viewExistingRegistration = async (event) => {
    try {
      const registration = myRegistrations.find((reg) => reg.eventId === event.id);

      if (registration) {
        // Each QR contains unique registration data
        const qrData = JSON.stringify({
          registrationId: registration.id,
          uniqueToken: registration.uniqueToken,
          userId: registration.userId,
          eventId: registration.eventId,
          eventTitle: event.title,
          userName: registration.fullName,
          studentId: registration.studentId,
          verificationCode: registration.verificationCode,
          timestamp: registration.registeredAt,
        });

        setQrValue(qrData);
        setSelectedEvent(event);
        setShowQRModal(true);
      }
    } catch (error) {
      Alert.alert("Error", "Failed to load registration details");
    }
  };

  const handleSubmitRegistration = async () => {
    // Validation
    if (
      !formData.fullName.trim() ||
      !formData.studentId.trim() ||
      !formData.phone.trim() ||
      !formData.department.trim()
    ) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }

    if (formData.phone.length < 10) {
      Alert.alert("Error", "Please enter a valid phone number");
      return;
    }

    setRegistering(true);

    try {
      const userId = auth.currentUser.uid;
      const userEmail = auth.currentUser.email;
      const verificationCode = generateVerificationCode();
      const uniqueToken = await generateUniqueToken();
      const timestamp = Date.now();
      const registrationId = `REG_${userId.substring(0, 8)}_${selectedEvent.id.substring(0, 8)}_${timestamp}`;

      console.log("Creating unique registration:", registrationId);
      console.log("Unique token:", uniqueToken);

      // Create unique registration document
      await setDoc(doc(db, "registrations", registrationId), {
        registrationId,
        uniqueToken, // Unique secure token for this registration
        userId,
        userEmail,
        eventId: selectedEvent.id,
        eventTitle: selectedEvent.title,
        eventDate: selectedEvent.date,
        eventTime: selectedEvent.startTime,
        eventVenue: selectedEvent.venue,
        fullName: formData.fullName.trim(),
        studentId: formData.studentId.trim(),
        phone: formData.phone.trim(),
        department: formData.department.trim(),
        year: formData.year.trim(),
        verificationCode,
        registeredAt: serverTimestamp(),
        registeredAtTimestamp: timestamp,
        checkedIn: false,
        checkedInAt: null,
        status: "confirmed",
      });

      // Update event's registeredUsers array
      const eventRef = doc(db, "events", selectedEvent.id);
      await updateDoc(eventRef, {
        registeredUsers: arrayUnion(userId),
      });

      // Generate unique QR code with all registration details
      const qrData = JSON.stringify({
        registrationId,
        uniqueToken, // This makes every QR code unique
        userId,
        eventId: selectedEvent.id,
        eventTitle: selectedEvent.title,
        userName: formData.fullName.trim(),
        studentId: formData.studentId.trim(),
        verificationCode,
        timestamp,
      });

      setQrValue(qrData);
      setShowRegistrationForm(false);
      setShowQRModal(true);

      // Reset form
      setFormData({
        fullName: "",
        studentId: "",
        phone: "",
        department: "",
        year: "",
      });

      Alert.alert(
        "Registration Successful! 🎉",
        `You are now registered for "${selectedEvent.title}".\n\nVerification Code: ${verificationCode}\n\nYour unique QR code has been generated.`
      );
    } catch (error) {
      console.error("Registration error:", error);
      Alert.alert("Registration Failed", error.message);
    } finally {
      setRegistering(false);
    }
  };

  const cancelRegistration = async (event) => {
    Alert.alert(
      "Cancel Registration",
      `Are you sure you want to cancel your registration for "${event.title}"?`,
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: async () => {
            try {
              const userId = auth.currentUser.uid;
              const registration = myRegistrations.find(
                (reg) => reg.eventId === event.id
              );

              if (registration) {
                await updateDoc(doc(db, "registrations", registration.id), {
                  status: "cancelled",
                  cancelledAt: serverTimestamp(),
                });

                const eventRef = doc(db, "events", event.id);
                const eventDoc = await getDoc(eventRef);
                const currentUsers = eventDoc.data().registeredUsers || [];
                const updatedUsers = currentUsers.filter((uid) => uid !== userId);
                
                await updateDoc(eventRef, {
                  registeredUsers: updatedUsers,
                });

                Alert.alert("Success", "Registration cancelled successfully");
              }
            } catch (error) {
              Alert.alert("Error", "Failed to cancel registration");
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.background}>
          <View style={[styles.sphere, styles.sphere1]} />
          <View style={[styles.sphere, styles.sphere2]} />
        </View>
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={styles.loadingText}>Loading events...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 3D Background */}
      <View style={styles.background}>
        <View style={[styles.sphere, styles.sphere1]} />
        <View style={[styles.sphere, styles.sphere2]} />
        <View style={[styles.sphere, styles.sphere3]} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerGlow} />
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>🎓 Campus Events</Text>
            <Text style={styles.headerSubtitle}>
              {showMyEvents ? "My Registrations" : "Discover & Register"}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => setShowMyEvents(!showMyEvents)}
              style={styles.myEventsButton}
              activeOpacity={0.8}
            >
              <Text style={styles.myEventsText}>
                {showMyEvents ? "📅 All" : "🎫 My"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleLogout}
              style={styles.logoutButton}
              activeOpacity={0.8}
            >
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Events List */}
      {showMyEvents ? (
        // My Registrations View
        myRegistrations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🎫</Text>
            <Text style={styles.emptyText}>No registrations yet</Text>
            <Text style={styles.emptySubtext}>
              Register for events to see them here
            </Text>
          </View>
        ) : (
          <FlatList
            data={myRegistrations}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const event = events.find((e) => e.id === item.eventId);
              if (!event) return null;

              return (
                <View style={styles.eventCard}>
                  <View style={styles.eventCardGlow} />

                  <View style={styles.registeredBadge}>
                    <Text style={styles.registeredBadgeText}>✅ Registered</Text>
                  </View>

                  <Text style={styles.eventTitle}>{event.title}</Text>

                  <View style={styles.eventDetails}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailIcon}>📅</Text>
                      <Text style={styles.detailText}>{event.date}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailIcon}>⏰</Text>
                      <Text style={styles.detailText}>{event.startTime}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailIcon}>📍</Text>
                      <Text style={styles.detailText}>{event.venue}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailIcon}>🔑</Text>
                      <Text style={styles.detailText}>
                        Code: {item.verificationCode}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailIcon}>🎫</Text>
                      <Text style={styles.detailText}>
                        ID: {item.registrationId}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      style={styles.viewQRButton}
                      onPress={() => viewExistingRegistration(event)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.viewQRButtonText}>View QR Code</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => cancelRegistration(event)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        )
      ) : events.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📅</Text>
          <Text style={styles.emptyText}>No events available</Text>
          <Text style={styles.emptySubtext}>Check back later for updates</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isRegistered = isRegisteredForEvent(item.id);
            const isFull =
              item.maxParticipants &&
              item.registeredUsers?.length >= item.maxParticipants;

            return (
              <View style={styles.eventCard}>
                <View style={styles.eventCardGlow} />

                <View style={styles.eventHeader}>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>
                      {item.category || "General"}
                    </Text>
                  </View>
                  {isRegistered && (
                    <View style={styles.registeredIndicator}>
                      <Text style={styles.registeredIndicatorText}>
                        ✅ Registered
                      </Text>
                    </View>
                  )}
                </View>

                <Text style={styles.eventTitle}>{item.title}</Text>

                <View style={styles.eventDetails}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailIcon}>🏛️</Text>
                    <Text style={styles.detailText}>{item.clubName}</Text>
                  </View>

                  {item.venue && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailIcon}>📍</Text>
                      <Text style={styles.detailText}>{item.venue}</Text>
                    </View>
                  )}

                  {item.startTime && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailIcon}>⏰</Text>
                      <Text style={styles.detailText}>
                        {item.startTime}
                        {item.endTime && ` - ${item.endTime}`}
                      </Text>
                    </View>
                  )}

                  <View style={styles.detailRow}>
                    <Text style={styles.detailIcon}>👥</Text>
                    <Text style={styles.detailText}>
                      {item.registeredUsers?.length || 0}
                      {item.maxParticipants
                        ? ` / ${item.maxParticipants}`
                        : ""}{" "}
                      registered
                    </Text>
                  </View>
                </View>

                {item.description && (
                  <Text style={styles.eventDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}

                <TouchableOpacity
                  style={[
                    styles.registerButton,
                    (isRegistered || isFull) && styles.registerButtonDisabled,
                  ]}
                  activeOpacity={0.8}
                  onPress={() => openRegistrationForm(item)}
                  disabled={isRegistered || isFull}
                >
                  <Text style={styles.registerButtonText}>
                    {isRegistered
                      ? "Already Registered"
                      : isFull
                      ? "Event Full"
                      : "Register Now"}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* Registration Form Modal */}
      <Modal
        visible={showRegistrationForm}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowRegistrationForm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.formContainer}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.formTitle}>📝 Registration Form</Text>
              <Text style={styles.formSubtitle}>{selectedEvent?.title}</Text>

              <TextInput
                style={styles.formInput}
                placeholder="Full Name *"
                placeholderTextColor="#9ca3af"
                value={formData.fullName}
                onChangeText={(text) =>
                  setFormData({ ...formData, fullName: text })
                }
              />

              <TextInput
                style={styles.formInput}
                placeholder="Student ID *"
                placeholderTextColor="#9ca3af"
                value={formData.studentId}
                onChangeText={(text) =>
                  setFormData({ ...formData, studentId: text })
                }
              />

              <TextInput
                style={styles.formInput}
                placeholder="Phone Number *"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
                value={formData.phone}
                onChangeText={(text) => setFormData({ ...formData, phone: text })}
              />

              <TextInput
                style={styles.formInput}
                placeholder="Department *"
                placeholderTextColor="#9ca3af"
                value={formData.department}
                onChangeText={(text) =>
                  setFormData({ ...formData, department: text })
                }
              />

              <TextInput
                style={styles.formInput}
                placeholder="Year (e.g., 2nd Year)"
                placeholderTextColor="#9ca3af"
                value={formData.year}
                onChangeText={(text) => setFormData({ ...formData, year: text })}
              />

              <TouchableOpacity
                style={[
                  styles.submitButton,
                  registering && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmitRegistration}
                disabled={registering}
                activeOpacity={0.8}
              >
                {registering ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Registration</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelFormButton}
                onPress={() => setShowRegistrationForm(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelFormButtonText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* QR Code Modal */}
      <Modal
        visible={showQRModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowQRModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.qrContainer}>
              <View style={styles.qrHeader}>
                <Text style={styles.qrTitle}>🎫 Your Unique Pass</Text>
                <Text style={styles.qrEventTitle}>{selectedEvent?.title}</Text>
              </View>

              <View style={styles.qrCodeWrapper}>
                {qrValue && (
                  <QRCode value={qrValue} size={220} backgroundColor="white" />
                )}
              </View>

              <View style={styles.qrInfo}>
                <Text style={styles.qrInfoText}>📅 {selectedEvent?.date}</Text>
                <Text style={styles.qrInfoText}>⏰ {selectedEvent?.startTime}</Text>
                <Text style={styles.qrInfoText}>📍 {selectedEvent?.venue}</Text>
              </View>

              <View style={styles.uniqueInfo}>
                <Text style={styles.uniqueInfoTitle}>🔒 Unique QR Code</Text>
                <Text style={styles.uniqueInfoText}>
                  This QR code is unique to your registration and cannot be duplicated
                </Text>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={() => setShowQRModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.closeModalButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a1a",
  },

  background: {
    position: "absolute",
    width: "100%",
    height: "100%",
    overflow: "hidden",
  },
  sphere: {
    position: "absolute",
    borderRadius: 9999,
    opacity: 0.1,
  },
  sphere1: {
    width: 300,
    height: 300,
    backgroundColor: "#8b5cf6",
    top: -150,
    right: -100,
    shadowColor: "#8b5cf6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 60,
    elevation: 10,
  },
  sphere2: {
    width: 250,
    height: 250,
    backgroundColor: "#a78bfa",
    bottom: 100,
    left: -80,
    shadowColor: "#a78bfa",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 50,
    elevation: 10,
  },
  sphere3: {
    width: 200,
    height: 200,
    backgroundColor: "#c4b5fd",
    top: "60%",
    right: -50,
    shadowColor: "#c4b5fd",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 40,
    elevation: 10,
  },

  header: {
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: "rgba(139, 92, 246, 0.1)",
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#ffffff",
    textShadowColor: "rgba(139, 92, 246, 0.5)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.6)",
    marginTop: 4,
  },
  headerActions: {
    flexDirection: "row",
    gap: 10,
  },
  myEventsButton: {
    backgroundColor: "rgba(139, 92, 246, 0.3)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#8b5cf6",
  },
  myEventsText: {
    color: "#c4b5fd",
    fontWeight: "600",
    fontSize: 14,
  },
  logoutButton: {
    backgroundColor: "rgba(239, 68, 68, 0.8)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  logoutText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },

  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a1a",
  },
  loadingText: {
    marginTop: 16,
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 16,
  },

  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.5)",
  },

  listContainer: {
    padding: 20,
    paddingTop: 10,
  },

  eventCard: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  eventCardGlow: {
    position: "absolute",
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 20,
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    zIndex: -1,
  },

  eventHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  categoryBadge: {
    backgroundColor: "rgba(139, 92, 246, 0.4)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#8b5cf6",
  },
  categoryText: {
    color: "#e9d5ff",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  registeredIndicator: {
    backgroundColor: "rgba(34, 197, 94, 0.3)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  registeredIndicatorText: {
    color: "#4ade80",
    fontSize: 12,
    fontWeight: "600",
  },
  registeredBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(34, 197, 94, 0.9)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    zIndex: 10,
  },
  registeredBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },

  eventTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 16,
  },
  eventDetails: {
    gap: 8,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(139, 92, 246, 0.08)",
    padding: 10,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#8b5cf6",
  },
  detailIcon: {
    fontSize: 18,
  },
  detailText: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 15,
    flex: 1,
    fontWeight: "500",
  },
  eventDescription: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },

  actionButtons: {
    flexDirection: "row",
    gap: 12,
  },
  viewQRButton: {
    flex: 1,
    backgroundColor: "#8b5cf6",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  viewQRButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "rgba(239, 68, 68, 0.8)",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
  },

  registerButton: {
    backgroundColor: "#8b5cf6",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  registerButtonDisabled: {
    opacity: 0.5,
    backgroundColor: "#6b7280",
  },
  registerButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "bold",
    textTransform: "uppercase",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  formContainer: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#1f2937",
    borderRadius: 20,
    padding: 24,
    maxHeight: "80%",
  },
  formTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 8,
    textAlign: "center",
  },
  formSubtitle: {
    fontSize: 16,
    color: "#8b5cf6",
    marginBottom: 24,
    textAlign: "center",
    fontWeight: "600",
  },
  formInput: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#ffffff",
    marginBottom: 16,
  },
  submitButton: {
    backgroundColor: "#8b5cf6",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "bold",
  },
  cancelFormButton: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 12,
  },
  cancelFormButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },

  modalContainer: {
    width: "90%",
    maxWidth: 400,
  },
  qrContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 30,
    alignItems: "center",
  },
  qrHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  qrTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 8,
  },
  qrEventTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#8b5cf6",
    textAlign: "center",
  },
  qrCodeWrapper: {
    padding: 20,
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    marginBottom: 24,
  },
  qrInfo: {
    width: "100%",
    backgroundColor: "#f3f4f6",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  qrInfoText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
  },
  uniqueInfo: {
    width: "100%",
    backgroundColor: "#dbeafe",
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#3b82f6",
  },
  uniqueInfoTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#1e40af",
    marginBottom: 4,
  },
  uniqueInfoText: {
    fontSize: 12,
    color: "#1e40af",
    textAlign: "center",
  },

  modalActions: {
    marginTop: 20,
  },
  closeModalButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  closeModalButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});