/**
 * Actionsheet — Bottom sheet component built with Reanimated + GestureHandler.
 * Follows gluestack-ui v2 API surface for consistency.
 *
 * Usage:
 *   <Actionsheet isOpen={open} onClose={close}>
 *     <ActionsheetBackdrop />
 *     <ActionsheetContent className="max-h-[85%]">
 *       <ActionsheetDragIndicatorWrapper>
 *         <ActionsheetDragIndicator />
 *       </ActionsheetDragIndicatorWrapper>
 *       {children}
 *     </ActionsheetContent>
 *   </Actionsheet>
 */
import * as React from "react";
import {
  View,
  Modal,
  Pressable,
  Text,
  type ViewProps,
  type PressableProps,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import {
  GestureDetector,
  Gesture,
} from "react-native-gesture-handler";
import { cn } from "@/lib/utils";

// ─── Context ───

interface ActionsheetContextValue {
  onClose: () => void;
}

const ActionsheetContext = React.createContext<ActionsheetContextValue>({
  onClose: () => {},
});

// ─── Root ───

interface ActionsheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function Actionsheet({ isOpen, onClose, children }: ActionsheetProps) {
  return (
    <ActionsheetContext.Provider value={{ onClose }}>
      <Modal
        visible={isOpen}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <View className="flex-1 justify-end">
            {children}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ActionsheetContext.Provider>
  );
}

// ─── Backdrop ───

interface ActionsheetBackdropProps {
  className?: string;
}

function ActionsheetBackdrop({ className }: ActionsheetBackdropProps) {
  const { onClose } = React.useContext(ActionsheetContext);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * 0.5,
  }));

  return (
    <Pressable
      onPress={onClose}
      className="absolute inset-0"
      accessibilityRole="button"
      accessibilityLabel="Close"
    >
      <Animated.View
        className={cn("absolute inset-0 bg-black", className)}
        style={animatedStyle}
      />
    </Pressable>
  );
}

// ─── Content ───

interface ActionsheetContentProps extends ViewProps {
  children: React.ReactNode;
  className?: string;
}

function ActionsheetContent({
  children,
  className,
  ...props
}: ActionsheetContentProps) {
  const { onClose } = React.useContext(ActionsheetContext);
  const translateY = useSharedValue(400);
  const startY = useSharedValue(0);

  React.useEffect(() => {
    translateY.value = withSpring(0, {
      damping: 25,
      stiffness: 300,
      mass: 0.8,
    });
  }, []);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      const newValue = startY.value + event.translationY;
      translateY.value = Math.max(0, newValue);
    })
    .onEnd((event) => {
      if (event.translationY > 100 || event.velocityY > 500) {
        translateY.value = withTiming(
          400,
          { duration: 200, easing: Easing.out(Easing.ease) },
          () => runOnJS(onClose)(),
        );
      } else {
        translateY.value = withSpring(0, {
          damping: 25,
          stiffness: 300,
        });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        className={cn(
          "bg-background rounded-t-2xl pt-1.5 overflow-hidden",
          className,
        )}
        style={animatedStyle}
        {...props}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Drag Indicator ───

function ActionsheetDragIndicatorWrapper({
  children,
  className,
  ...props
}: ViewProps & { children: React.ReactNode; className?: string }) {
  return (
    <View
      className={cn("items-center py-2", className)}
      {...props}
    >
      {children}
    </View>
  );
}

function ActionsheetDragIndicator({ className }: { className?: string }) {
  return (
    <View
      className={cn(
        "w-9 h-1 rounded-full bg-muted-foreground/30",
        className,
      )}
    />
  );
}

// ─── Item ───

interface ActionsheetItemProps extends PressableProps {
  children: React.ReactNode;
  className?: string;
  isDisabled?: boolean;
}

function ActionsheetItem({
  children,
  className,
  isDisabled,
  ...props
}: ActionsheetItemProps) {
  return (
    <Pressable
      className={cn(
        "flex-row items-center px-4 py-3.5 gap-3 active:bg-secondary",
        isDisabled && "opacity-40",
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {children}
    </Pressable>
  );
}

// ─── Item Text ───

function ActionsheetItemText({
  className,
  ...props
}: React.ComponentProps<typeof import("react-native").Text>) {
  return (
    <Text
      className={cn("text-foreground text-base", className)}
      {...props}
    />
  );
}

export {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetItem,
  ActionsheetItemText,
};
