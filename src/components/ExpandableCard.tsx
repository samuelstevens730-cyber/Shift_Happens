"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface ExpandableCardProps {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  borderColor: string;
  collapsedContent: React.ReactNode;
  expandedContent: React.ReactNode;
  fullViewLink?: string;
  fullViewText?: string;
  disabled?: boolean;
}

export default function ExpandableCard({
  title,
  icon: Icon,
  iconColor,
  borderColor,
  collapsedContent,
  expandedContent,
  fullViewLink,
  fullViewText,
  disabled = false,
}: ExpandableCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (disabled) {
    return (
      <div className={`bento-card ${borderColor} bento-card-disabled`}>
        <div className="flex flex-col items-center justify-center gap-3 h-full">
          <Icon className={`w-10 h-10 md:w-12 md:h-12 ${iconColor}`} strokeWidth={1.5} />
          <span className="bento-card-title">{title}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bento-card bento-card-expandable ${borderColor} transition-all duration-300 ease-out ${
        isExpanded ? "bento-card-expanded" : ""
      }`}
      onClick={() => !isExpanded && setIsExpanded(true)}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          <div className="flex items-center gap-3">
            <Icon className={`w-6 h-6 ${iconColor}`} strokeWidth={1.5} />
            <span className="font-semibold text-sm tracking-wide">{title}</span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {!isExpanded ? (
            <div className="p-4 pt-0 flex flex-col items-center justify-center">
              {collapsedContent}
            </div>
          ) : (
            <div className="p-4 pt-0 overflow-y-auto max-h-[55vh]">
              {expandedContent}

              {/* View full link */}
              {fullViewLink && (
                <Link
                  href={fullViewLink}
                  className={`flex items-center justify-center gap-2 mt-4 pt-3 border-t border-white/10 text-xs ${iconColor} hover:opacity-80 transition-colors`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {fullViewText}
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
