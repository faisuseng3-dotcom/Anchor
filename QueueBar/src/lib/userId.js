import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';

const KEY = 'queuebar_user_id';

export async function getUserId() {
  let id = await AsyncStorage.getItem(KEY);
  if (!id) {
    id = uuidv4();
    await AsyncStorage.setItem(KEY, id);
  }
  return id;
}
