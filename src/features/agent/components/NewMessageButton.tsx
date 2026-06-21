import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

interface NewMessageButtonProps {
  visible: boolean;
  onClick: () => void;
}

export const NewMessageButton: React.FC<NewMessageButtonProps> = ({
  visible,
  onClick,
}) => {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          onClick={onClick}
          className="flex items-center gap-2 px-4 py-2 mx-auto mb-2 text-sm bg-bg-card border border-border-primary rounded-full cursor-pointer hover:bg-bg-secondary transition-colors z-10 shadow-sm"
        >
          <ChevronDown className="w-4 h-4" />
          <span>新消息</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
};