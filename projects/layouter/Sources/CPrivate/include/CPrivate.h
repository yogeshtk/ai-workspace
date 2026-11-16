#ifndef CPRIVATE_H
#define CPRIVATE_H

#include <CoreFoundation/CoreFoundation.h>
#include <ApplicationServices/ApplicationServices.h>

// Private SkyLight / HIServices symbols (re-exported by CoreGraphics / ApplicationServices).
// Used read-only to discover Spaces and which Space a window lives on.

typedef int CGSConnectionID;

CGSConnectionID CGSMainConnectionID(void);

// [{ "Display Identifier": uuid | "Main", "Current Space": {...}, "Spaces": [{ "ManagedSpaceID": n, "type": 0|4, ... }] }]
CF_RETURNS_RETAINED CFArrayRef CGSCopyManagedDisplaySpaces(CGSConnectionID cid);

// mask 0x7 = all spaces. Returns array of space IDs (CFNumber).
CF_RETURNS_RETAINED CFArrayRef CGSCopySpacesForWindows(CGSConnectionID cid, int mask, CFArrayRef windowIDs);

// Maps an AX window element to its CGWindowID.
AXError _AXUIElementGetWindow(AXUIElementRef element, CGWindowID *outWindowID);

#endif
