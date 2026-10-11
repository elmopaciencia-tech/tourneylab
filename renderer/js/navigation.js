// Small in-memory history for TourneyLab's view-based router.

const copyEntry = entry => ({ ...entry });
const sameEntry = (left, right) => left?.view === right?.view
  && left?.eventId === right?.eventId
  && left?.sectionId === right?.sectionId;

export function createNavigationHistory(initialEntry) {
  const entries = [copyEntry(initialEntry)];
  let index = 0;

  function findAvailableIndex(direction, isAvailable = () => true) {
    for (let candidate = index + direction; candidate >= 0 && candidate < entries.length; candidate += direction) {
      if (isAvailable(entries[candidate])) return candidate;
    }
    return -1;
  }

  function move(direction, isAvailable) {
    const nextIndex = findAvailableIndex(direction, isAvailable);
    if (nextIndex < 0) return null;
    index = nextIndex;
    return copyEntry(entries[index]);
  }

  return {
    push(entry) {
      if (sameEntry(entries[index], entry)) return;
      entries.splice(index + 1);
      entries.push(copyEntry(entry));
      index = entries.length - 1;
    },
    replace(entry) {
      entries[index] = copyEntry(entry);
    },
    back(isAvailable) {
      return move(-1, isAvailable);
    },
    forward(isAvailable) {
      return move(1, isAvailable);
    },
    canBack(isAvailable) {
      return findAvailableIndex(-1, isAvailable) >= 0;
    },
    canForward(isAvailable) {
      return findAvailableIndex(1, isAvailable) >= 0;
    }
  };
}
